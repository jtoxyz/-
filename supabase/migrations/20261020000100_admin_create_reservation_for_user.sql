-- 管理者が、アカウント登録済みの学生の予約を作る（受付終了後の追加・枠の作り直しなど）。
-- ・予約は本人のアカウント（user_id）につなぐので、本人のマイチケットにそのまま表示される。
-- ・受付期間や受付停止は無視する（管理者の判断で追加するため）。ブラックリストは従来どおり予約トリガーで拒否される。
-- ・満席の枠は p_allow_over_capacity = true のときだけ、定員を1人分増やして追加する。
-- ・支払いが必要な企画では「支払い済みにする」か「支払い日時（payment_visit_slots）を選ぶ」のどちらかが必要。
-- ・操作は admin_action_logs に記録する。

begin;

create or replace function public.admin_create_reservation_for_user(
  p_user_id uuid,
  p_event_id uuid,
  p_event_slot_id uuid,
  p_paid boolean default false,
  p_payment_visit_slot_id uuid default null,
  p_allow_over_capacity boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
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
end $$;

revoke all on function public.admin_create_reservation_for_user(uuid, uuid, uuid, boolean, uuid, boolean, text) from public, anon;
grant execute on function public.admin_create_reservation_for_user(uuid, uuid, uuid, boolean, uuid, boolean, text) to authenticated;

notify pgrst, 'reload schema';
commit;
