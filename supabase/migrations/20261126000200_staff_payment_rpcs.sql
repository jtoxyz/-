-- 受付の係が支払いを確認する方式：検索・受領・取消・集計のRPC
-- すべて security definer。anon には公開せず、関数の中でも can_operate_event で権限を確認する。

-- 同じ受領を二重に打ち消せないようにする（同時に取り消しが走っても1回だけ）
create unique index if not exists uq_payment_receipts_one_undo_per_receipt
  on public.payment_receipts(reverses_receipt_id)
  where reverses_receipt_id is not null;

-- 1. QR（URL か public_token）から支払い対象を探す
create or replace function public.staff_find_payment_target(p_event_id uuid, p_query text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_token text;
  v_res public.reservations%rowtype;
  v_title text;
  v_mode text;
  v_items jsonb;
  v_pending integer;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください。';
  end if;

  if p_event_id is not null and not public.can_operate_event(p_event_id) then
    raise exception 'この企画の支払いを受け付ける権限がありません。';
  end if;

  v_token := (regexp_match(
    lower(normalize(coalesce(p_query, ''), NFKC)),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
  ))[1];
  if v_token is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select * into v_res from public.reservations r where r.public_token = v_token;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;

  select e.title, e.payment_confirm_mode into v_title, v_mode
    from public.events e where e.id = v_res.event_id;

  if p_event_id is null then
    if not public.can_operate_event(v_res.event_id) then
      raise exception 'この企画の支払いを受け付ける権限がありません。';
    end if;
  elsif v_res.event_id <> p_event_id then
    if public.can_operate_event(v_res.event_id) then
      return jsonb_build_object('status', 'other_event', 'event_id', v_res.event_id, 'event_title', v_title);
    end if;
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_mode is distinct from 'staff' then
    raise exception 'この企画は学生がQRを読む方式です。受付画面では受け付けられません。';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'reservation_id', r.id,
      'ticket_option_label', o.label,
      'amount_yen', coalesce(o.price_yen, 0),
      'slot_label', s.label,
      'slot_starts_at', s.starts_at,
      'status', r.status,
      'payment_status', r.payment_status,
      'payment_due_at', r.payment_due_at,
      'paid_at', r.paid_at,
      'received_at', case when lr.action = 'received' then lr.created_at end,
      'received_by_name', case when lr.action = 'received' then lr.operator_name end,
      'received_by_me', coalesce(lr.action = 'received' and lr.operator_user_id = auth.uid(), false),
      'visit_starts_at', v.starts_at,
      'visit_ends_at', v.ends_at,
      'visit_location', v.location
    ) order by s.starts_at nulls last, r.created_at, r.id), '[]'::jsonb),
    coalesce(sum(coalesce(o.price_yen, 0)) filter (where r.status = 'reserved' and r.payment_status = 'pending'), 0)
    into v_items, v_pending
    from public.reservations r
    left join public.event_ticket_options o on o.id = r.ticket_option_id
    left join public.event_slots s on s.id = r.event_slot_id
    left join public.payment_visit_slots v on v.id = r.payment_visit_slot_id
    left join lateral (
      select pr.action, pr.created_at, pr.operator_name, pr.operator_user_id
        from public.payment_receipts pr
       where pr.reservation_id = r.id
       order by pr.created_at desc, pr.id desc
       limit 1
    ) lr on true
   where r.event_id = v_res.event_id
     and r.status <> 'cancelled'
     and (
       (v_res.user_id is not null and r.user_id = v_res.user_id)
       or (v_res.user_id is null and r.student_number = v_res.student_number)
     );

  if jsonb_array_length(v_items) = 0 then
    return jsonb_build_object(
      'status', case when v_res.payment_status = 'expired' then 'expired' else 'cancelled' end,
      'student_name', v_res.student_name,
      'student_number', v_res.student_number
    );
  end if;

  return jsonb_build_object(
    'status', 'found',
    'event_id', v_res.event_id,
    'event_title', v_title,
    'student_name', v_res.student_name,
    'student_number', v_res.student_number,
    'pending_total_yen', v_pending,
    'reservations', v_items
  );
end $function$;

-- 2. 支払いを受け取る（最大20件。行ロックして二重受領を防ぐ）
create or replace function public.staff_receive_payment(p_reservation_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ids uuid[];
  v_found integer;
  v_events integer;
  v_event_id uuid;
  v_mode text;
  v_row record;
  v_receipt uuid;
  v_amount integer;
  v_received jsonb := '[]'::jsonb;
  v_already jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_total integer := 0;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください。';
  end if;
  if coalesce(array_length(p_reservation_ids, 1), 0) = 0 then
    raise exception '受け取る予約を選んでください。';
  end if;
  if array_length(p_reservation_ids, 1) > 20 then
    raise exception '一度に受け取れるのは20件までです。';
  end if;

  select coalesce(array_agg(distinct x order by x), '{}') into v_ids from unnest(p_reservation_ids) as x;

  -- id 順にロック（デッドロック回避）
  perform 1 from public.reservations r where r.id = any(v_ids) order by r.id for update;

  select count(*), count(distinct r.event_id), min(r.event_id::text)::uuid
    into v_found, v_events, v_event_id
    from public.reservations r where r.id = any(v_ids);

  if v_found = 0 or v_found <> array_length(v_ids, 1) then
    raise exception '予約が見つかりません。';
  end if;
  if v_events <> 1 then
    raise exception '別々の企画の予約はまとめて受け取れません。';
  end if;
  if not public.can_operate_event(v_event_id) then
    raise exception 'この企画の支払いを受け付ける権限がありません。';
  end if;

  select e.payment_confirm_mode into v_mode from public.events e where e.id = v_event_id;
  if v_mode is distinct from 'staff' then
    raise exception 'この企画は学生がQRを読む方式です。受付画面では受け付けられません。';
  end if;

  for v_row in
    select r.id, r.status, r.payment_status, r.paid_at
      from public.reservations r
     where r.id = any(v_ids)
     order by r.id
  loop
    if v_row.status = 'reserved' and v_row.payment_status = 'pending' then
      update public.reservations
         set payment_status = 'paid', paid_at = now(), payment_confirmed_by = auth.uid()
       where id = v_row.id;
      v_receipt := public.log_payment_receipt(v_row.id, 'received');
      select pr.amount_yen into v_amount from public.payment_receipts pr where pr.id = v_receipt;
      v_received := v_received || jsonb_build_object('reservation_id', v_row.id, 'amount_yen', v_amount);
      v_count := v_count + 1;
      v_total := v_total + v_amount;
    elsif v_row.payment_status = 'paid' then
      v_already := v_already || jsonb_build_object(
        'reservation_id', v_row.id,
        'paid_at', v_row.paid_at,
        'received_by_name', (
          select pr.operator_name
            from public.payment_receipts pr
           where pr.reservation_id = v_row.id
           order by pr.created_at desc, pr.id desc
           limit 1
        )
      );
    else
      v_unavailable := v_unavailable || to_jsonb(v_row.id::text);
    end if;
  end loop;

  return jsonb_build_object(
    'received', v_received,
    'already_paid', v_already,
    'unavailable', v_unavailable,
    'received_count', v_count,
    'received_total_yen', v_total
  );
end $function$;

-- 3. 受け取りを取り消す
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
  select pr.* into v_recv
    from public.payment_receipts pr
   where pr.reservation_id = v_res.id
     and pr.action = 'received'
     and not exists (select 1 from public.payment_receipts u where u.reverses_receipt_id = pr.id)
   order by pr.created_at desc, pr.id desc
   limit 1;
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

-- 4. 係ごとの受け取り集計（現金の照合用）
create or replace function public.staff_get_payment_summary(p_event_id uuid, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_date date;
  v_today date := (now() at time zone 'Asia/Tokyo')::date;
  v_is_admin boolean;
  v_operators jsonb;
  v_total jsonb;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'ログインしてください。';
  end if;
  if not public.can_operate_event(p_event_id) then
    raise exception 'この企画の支払いを受け付ける権限がありません。';
  end if;

  v_is_admin := exists (select 1 from public.admin_users au where au.user_id = auth.uid());
  v_date := coalesce(p_date, v_today);
  if not v_is_admin and v_date <> v_today then
    raise exception 'スタッフは今日の分だけ確認できます。';
  end if;

  with rows_ as (
    select
      pr.id as receipt_id, pr.created_at, pr.action, pr.reservation_id, pr.amount_yen, pr.operator_name,
      case when pr.action = 'received' then pr.operator_user_id else rv.operator_user_id end as attributed_user_id,
      case when pr.action = 'received' then pr.operator_name else rv.operator_name end as attributed_name,
      (pr.action = 'received' and exists (select 1 from public.payment_receipts u where u.reverses_receipt_id = pr.id)) as reversed
      from public.payment_receipts pr
      left join public.payment_receipts rv on rv.id = pr.reverses_receipt_id
     where pr.event_id = p_event_id
       and (pr.created_at at time zone 'Asia/Tokyo')::date = v_date
       and (v_is_admin
            or (case when pr.action = 'received' then pr.operator_user_id else rv.operator_user_id end) = auth.uid())
  ), grouped as (
    select
      t.attributed_user_id,
      case when t.attributed_user_id is null then '（記録外の取消）' else max(t.attributed_name) end as operator_name,
      (count(*) filter (where t.action = 'received'))::int as received_count,
      (coalesce(sum(t.amount_yen) filter (where t.action = 'received'), 0))::int as received_yen,
      (count(*) filter (where t.action = 'undone'))::int as undone_count,
      (coalesce(sum(t.amount_yen) filter (where t.action = 'undone'), 0))::int as undone_yen
      from rows_ t
     group by t.attributed_user_id
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'operator_user_id', g.attributed_user_id,
        'operator_name', g.operator_name,
        'received_count', g.received_count,
        'received_yen', g.received_yen,
        'undone_count', g.undone_count,
        'undone_yen', g.undone_yen,
        'net_count', g.received_count - g.undone_count,
        'net_yen', g.received_yen - g.undone_yen
      ) order by g.attributed_user_id is null, g.operator_name, g.attributed_user_id) from grouped g), '[]'::jsonb),
    jsonb_build_object(
      'net_count', coalesce((select sum(g.received_count - g.undone_count) from grouped g where g.attributed_user_id is not null), 0)::int,
      'net_yen', coalesce((select sum(g.received_yen - g.undone_yen) from grouped g where g.attributed_user_id is not null), 0)::int
    ),
    coalesce((select jsonb_agg(jsonb_build_object(
        'receipt_id', t.receipt_id,
        'created_at', t.created_at,
        'action', t.action,
        'reservation_id', t.reservation_id,
        'student_name', r.student_name,
        'student_number', r.student_number,
        'ticket_option_label', o.label,
        'amount_yen', t.amount_yen,
        'operator_name', t.operator_name,
        'attributed_user_id', t.attributed_user_id,
        'reversed', t.reversed
      ) order by t.created_at desc, t.receipt_id desc)
        from rows_ t
        left join public.reservations r on r.id = t.reservation_id
        left join public.event_ticket_options o on o.id = r.ticket_option_id), '[]'::jsonb)
    into v_operators, v_total, v_items;

  return jsonb_build_object(
    'date', to_char(v_date, 'YYYY-MM-DD'),
    'operators', v_operators,
    'total', v_total,
    'items', v_items
  );
end $function$;

revoke execute on function public.staff_find_payment_target(uuid, text) from public, anon;
revoke execute on function public.staff_receive_payment(uuid[]) from public, anon;
revoke execute on function public.staff_undo_payment(uuid) from public, anon;
revoke execute on function public.staff_get_payment_summary(uuid, date) from public, anon;
grant execute on function public.staff_find_payment_target(uuid, text) to authenticated;
grant execute on function public.staff_receive_payment(uuid[]) to authenticated;
grant execute on function public.staff_undo_payment(uuid) to authenticated;
grant execute on function public.staff_get_payment_summary(uuid, date) to authenticated;
