-- 管理画面からの支払い変更も受領記録に残す
-- 1. 「打ち消す受領」の決め方を内部関数にまとめる（staff_undo_payment と共通）
create or replace function public.payment_receipt_to_undo(p_reservation_id uuid)
returns setof public.payment_receipts
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- まだ打ち消されていない最新の受領
  select pr.*
    from public.payment_receipts pr
   where pr.reservation_id = p_reservation_id
     and pr.action = 'received'
     and not exists (select 1 from public.payment_receipts u where u.reverses_receipt_id = pr.id)
   order by pr.created_at desc, pr.id desc
   limit 1;
$function$;

revoke execute on function public.payment_receipt_to_undo(uuid) from public, anon, authenticated;

-- staff_undo_payment は同じ関数を使う（引数・戻り値・権限は変えない）
create or replace function public.staff_undo_payment(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_res public.reservations%rowtype;
  v_mode text;
  v_is_admin boolean;
  v_recv public.payment_receipts%rowtype;
  v_recv_found boolean;
  v_amount integer;
  v_receipt uuid;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください。';
  end if;

  select * into v_res from public.reservations r where r.id = p_reservation_id for update;
  if not found then
    raise exception '予約が見つかりません。';
  end if;
  if not public.can_operate_event(v_res.event_id) then
    raise exception 'この企画の支払いを受け付ける権限がありません。';
  end if;

  select e.payment_confirm_mode into v_mode from public.events e where e.id = v_res.event_id;
  if v_mode is distinct from 'staff' then
    raise exception 'この企画は学生がQRを読む方式です。受付画面では受け付けられません。';
  end if;

  if v_res.status = 'used' then
    raise exception 'チケット使用済みのため取り消せません。';
  end if;
  if v_res.payment_status <> 'paid' then
    raise exception '支払い済みの予約ではありません。';
  end if;

  -- まだ打ち消されていない最新の受領
  select * into v_recv from public.payment_receipt_to_undo(v_res.id);
  v_recv_found := found;

  v_is_admin := exists (select 1 from public.admin_users au where au.user_id = auth.uid());
  if not v_is_admin then
    if not v_recv_found
       or v_recv.operator_user_id is distinct from auth.uid()
       or (v_recv.created_at at time zone 'Asia/Tokyo')::date <> (now() at time zone 'Asia/Tokyo')::date then
      raise exception '取り消せるのは、自分が今日受け取った分だけです。管理者に依頼してください。';
    end if;
  end if;

  update public.reservations
     set payment_status = 'pending', paid_at = null, payment_confirmed_by = null
   where id = v_res.id;

  v_receipt := public.log_payment_receipt(v_res.id, 'undone', case when v_recv_found then v_recv.id end);
  select pr.amount_yen into v_amount from public.payment_receipts pr where pr.id = v_receipt;

  return jsonb_build_object(
    'reservation_id', v_res.id,
    'amount_yen', v_amount,
    'will_expire', (v_res.payment_due_at is not null and v_res.payment_due_at + public.payment_due_grace() <= now())
  );
end $function$;

-- 2. 管理画面の支払い変更
create or replace function public.admin_set_reservation_payment_status(p_reservation_id uuid, p_paid boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old text;
  v_status text;
  v_recv public.payment_receipts%rowtype;
  v_recv_found boolean;
begin
  if not exists (
    select 1 from public.admin_users au where au.user_id = auth.uid()
  ) then
    raise exception '管理者権限が必要です。';
  end if;

  select r.payment_status, r.status into v_old, v_status
    from public.reservations r
   where r.id = p_reservation_id
   for update;

  if p_paid then
    if not found or v_status = 'cancelled' then
      raise exception '対象の予約を更新できませんでした。';
    end if;
    if v_old = 'paid' then
      return;
    end if;
    update public.reservations
       set payment_status = 'paid',
           paid_at = now(),
           payment_confirmed_by = auth.uid()
     where id = p_reservation_id;
    perform public.log_payment_receipt(p_reservation_id, 'received');
  else
    if not found or v_old = 'not_required' then
      raise exception '対象の予約を更新できませんでした。';
    end if;
    -- 打ち消す受領は更新前に決める
    select * into v_recv from public.payment_receipt_to_undo(p_reservation_id);
    v_recv_found := found;

    update public.reservations
       set payment_status = case
             when payment_due_at is not null and payment_due_at <= now() then 'expired'
             else 'pending'
           end,
           paid_at = null,
           payment_confirmed_by = null
     where id = p_reservation_id;

    if v_old = 'paid' then
      perform public.log_payment_receipt(p_reservation_id, 'undone', case when v_recv_found then v_recv.id end);
    end if;
  end if;
end;
$function$;

-- 3. 管理者が予約を作るとき、支払い済みなら受領を記録
create or replace function public.admin_create_reservation_for_user(p_user_id uuid, p_event_id uuid, p_event_slot_id uuid, p_paid boolean DEFAULT false, p_payment_visit_slot_id uuid DEFAULT NULL::uuid, p_allow_over_capacity boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_admin uuid := auth.uid();
  v_profile public.user_profiles%rowtype;
  v_event public.events%rowtype;
  v_slot public.event_slots%rowtype;
  v_visit public.payment_visit_slots%rowtype;
  v_reserved bigint;
  v_walkin bigint;
  v_capacity_raised boolean := false;
  v_res public.reservations%rowtype;
begin
  if not exists (select 1 from public.admin_users au where au.user_id = v_admin) then
    raise exception '管理者権限が必要です。';
  end if;

  select * into v_profile from public.user_profiles where user_id = p_user_id;
  if not found then
    raise exception 'アカウントが見つかりません。本人に一度予約サイトへログインしてもらってください。';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception '企画が見つかりません。';
  end if;

  select * into v_slot from public.event_slots where id = p_event_slot_id and event_id = p_event_id for update;
  if not found then
    raise exception '受け取り枠が見つかりません。';
  end if;

  if v_event.slot_selection_mode = 'single' then
    if exists (
      select 1 from public.reservations r
      where r.event_id = p_event_id and r.student_number = v_profile.student_number
        and r.status in ('reserved','used') and r.ticket_type = 'reservation'
    ) then
      raise exception 'この学生はすでにこの企画を予約しています。';
    end if;
  elsif exists (
    select 1 from public.reservations r
    where r.event_slot_id = p_event_slot_id and r.student_number = v_profile.student_number
      and r.status in ('reserved','used') and r.ticket_type = 'reservation'
  ) then
    raise exception 'この学生はすでにこの枠を予約しています。';
  end if;

  if coalesce(v_event.payment_required, false) then
    if not coalesce(p_paid, false) and p_payment_visit_slot_id is null then
      raise exception '「支払い済みにする」か、支払い日時を選んでください。';
    end if;
    if not coalesce(p_paid, false) then
      select * into v_visit from public.payment_visit_slots
      where id = p_payment_visit_slot_id and is_active and ends_at > now();
      if not found then
        raise exception '選んだ支払い日時は使えません。終了前の支払い日時を選んでください。';
      end if;
    end if;
  end if;

  select
    count(*) filter (where ticket_type = 'reservation'),
    count(*) filter (where ticket_type = 'walkin')
  into v_reserved, v_walkin
  from public.reservations
  where event_slot_id = p_event_slot_id and status in ('reserved','used');
  v_reserved := v_reserved + (select count(*) from public.admin_pre_registrations
                               where event_slot_id = p_event_slot_id and status = 'reserved' and ticket_type = 'reservation');
  v_walkin := v_walkin + (select count(*) from public.admin_pre_registrations
                           where event_slot_id = p_event_slot_id and status = 'reserved' and ticket_type = 'walkin');

  if v_reserved >= v_slot.reservation_capacity or v_reserved + v_walkin >= v_slot.total_capacity then
    if not coalesce(p_allow_over_capacity, false) then
      raise exception 'この枠は満席です。追加する場合は「満席でも定員を1人分増やして追加する」を選んでください。';
    end if;
    update public.event_slots
       set reservation_capacity = greatest(reservation_capacity, v_reserved + 1),
           total_capacity = greatest(total_capacity, v_reserved + v_walkin + 1)
     where id = p_event_slot_id;
    v_capacity_raised := true;
  end if;

  insert into public.reservations (
    event_id, event_slot_id, student_name, student_number, university_email, ticket_type, status, user_id
  ) values (
    p_event_id, p_event_slot_id, v_profile.student_name, v_profile.student_number, v_profile.university_email,
    'reservation', 'reserved', v_profile.user_id
  ) returning * into v_res;

  if coalesce(v_event.payment_required, false) then
    if coalesce(p_paid, false) then
      update public.reservations
         set payment_status = 'paid', paid_at = now(), payment_confirmed_by = v_admin
       where id = v_res.id
       returning * into v_res;
      perform public.log_payment_receipt(v_res.id, 'received');
    else
      update public.reservations
         set payment_visit_slot_id = v_visit.id, payment_due_at = v_visit.ends_at
       where id = v_res.id
       returning * into v_res;
    end if;
  end if;

  insert into public.admin_action_logs(action, target_table, target_id, details, actor_user_id)
  values (
    'admin_create_reservation_for_user', 'reservations', v_res.id::text,
    jsonb_build_object(
      'student_number', v_profile.student_number,
      'event_id', p_event_id,
      'slot_label', v_slot.label,
      'payment_status', v_res.payment_status,
      'capacity_raised', v_capacity_raised,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    ),
    v_admin
  );

  return jsonb_build_object(
    'id', v_res.id,
    'event_id', v_res.event_id,
    'event_slot_id', v_res.event_slot_id,
    'slot_label', v_slot.label,
    'ticket_code', v_res.ticket_code,
    'public_token', v_res.public_token,
    'status', v_res.status,
    'payment_status', v_res.payment_status,
    'capacity_raised', v_capacity_raised
  );
end $function$;

-- 4. 管理者用の受領一覧（企画ごと、予約ごと）
create or replace function public.admin_list_payment_receipts(p_event_id uuid)
returns table(reservation_id uuid, last_received_at timestamptz, last_received_by text, undone_count integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.admin_users au where au.user_id = auth.uid()) then
    raise exception '管理者権限が必要です。';
  end if;

  return query
  select
    pr.reservation_id,
    (array_agg(pr.created_at order by pr.created_at desc, pr.id desc)
       filter (where pr.action = 'received'
               and not exists (select 1 from public.payment_receipts u where u.reverses_receipt_id = pr.id)))[1],
    (array_agg(pr.operator_name order by pr.created_at desc, pr.id desc)
       filter (where pr.action = 'received'
               and not exists (select 1 from public.payment_receipts u where u.reverses_receipt_id = pr.id)))[1],
    (count(*) filter (where pr.action = 'undone'))::int
    from public.payment_receipts pr
   where pr.event_id = p_event_id
   group by pr.reservation_id;
end $function$;

revoke execute on function public.admin_list_payment_receipts(uuid) from public, anon;
grant execute on function public.admin_list_payment_receipts(uuid) to authenticated;
