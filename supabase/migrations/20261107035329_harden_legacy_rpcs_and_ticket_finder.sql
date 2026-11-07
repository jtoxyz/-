-- 予約サイトのセキュリティ修正（2026-11-07）
--
-- 1. 旧予約RPC（create_reservation / create_walkin_reservation / create_reservations_bulk）は
--    create_my_* からだけ呼ぶ。学生が直接呼ぶと、登録した氏名と違う名前での予約、支払い日時の選択の回避、
--    初回登録なしの予約、マイチケットに出ない予約（user_id なし）が作れてしまうため。
--    create_my_* は SECURITY DEFINER（所有者 postgres）なので、権限を外しても内部からは呼べる。
--    関数の定義・引数・戻り値は変えない（AGENTS.md の正式RPC契約はそのまま）。
-- 2. 匿名では意味のないRPC、トリガー専用の関数から API 経由の実行権限を外す。
--    トリガーは EXECUTE 権限がなくても発火する（ticket_code / public_token の生成は従来どおり）。
-- 3. 「チケットを探す」はログイン必須にする。代理で使用した人を reservations.used_by に記録する。
-- 4. 学生が自分のキャンセル済み予約（支払い期限切れなど）を確認できる RPC を追加する。

-- 1. 旧予約RPC
revoke execute on function public.create_reservation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_walkin_reservation(uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.create_reservations_bulk(uuid, uuid[], text, text, text) from public, anon, authenticated;
grant execute on function public.create_reservation(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.create_walkin_reservation(uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.create_reservations_bulk(uuid, uuid[], text, text, text) to service_role;

-- 2. 匿名で使う必要のない RPC と、トリガー専用の関数
revoke execute on function public.get_my_ticket(uuid) from public, anon;
grant execute on function public.get_my_ticket(uuid) to authenticated;
revoke execute on function public.get_ticket_payment_state(text) from public, anon;
grant execute on function public.get_ticket_payment_state(text) to authenticated;

revoke execute on function public.apply_reservation_ticket_option() from public, anon, authenticated;
revoke execute on function public.ensure_reservation_tokens() from public, anon, authenticated;
revoke execute on function public.validate_reservation_student_number() from public, anon, authenticated;
revoke execute on function public.set_student_department_code_updated_at() from public, anon, authenticated;

-- 3. 「チケットを探す」はログイン必須。代理で使用した人を記録する
alter table public.reservations
  add column if not exists used_by uuid references auth.users(id) on delete set null;
comment on column public.reservations.used_by is 'チケットを使用済みにしたログイン中の利用者（「チケットを探す」からの代理使用を含む）';
create index if not exists idx_reservations_used_by on public.reservations(used_by) where used_by is not null;

revoke execute on function public.find_ticket(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.find_ticket(uuid, uuid, text, text, text) to authenticated;
revoke execute on function public.get_ticket(text) from public, anon;
grant execute on function public.get_ticket(text) to authenticated;

create or replace function public.use_ticket(p_public_token text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_reservation public.reservations%rowtype;
  v_event public.events%rowtype;
  v_use_starts_at timestamptz;
  v_use_ends_at timestamptz;
  v_use_enabled boolean;
begin
  if auth.uid() is null then
    raise exception '大学Googleアカウントでログインしてください。';
  end if;

  select * into v_reservation
  from public.reservations
  where public_token = p_public_token
  for update;

  if not found then
    raise exception 'チケットが見つかりません。';
  end if;

  if public.is_user_blacklisted(v_reservation.student_number, v_reservation.university_email) then
    raise exception '現在このサービスを利用できません。';
  end if;

  if v_reservation.status = 'cancelled' then
    raise exception 'このチケットはキャンセルされています。';
  end if;

  if v_reservation.status = 'used' then
    return json_build_object('status', 'used', 'used_at', v_reservation.used_at);
  end if;

  select * into v_event from public.events where id = v_reservation.event_id;

  if v_event.is_ticket_use_suspended
     or (v_event.auto_suspend_at is not null and now() >= v_event.auto_suspend_at) then
    raise exception '現在、チケットを使用できません。';
  end if;

  if v_event.ticket_enabled is distinct from true
     or v_event.use_button_enabled is distinct from true then
    raise exception 'このイベントではチケットの使用ボタンが有効化されていません。';
  end if;

  select
    case when v_reservation.ticket_type = 'walkin'
      then coalesce(es.walkin_use_starts_at, es.walkin_starts_at, es.ticket_use_starts_at, es.starts_at)
      else coalesce(es.reservation_use_starts_at, es.ticket_use_starts_at, es.starts_at)
    end,
    case when v_reservation.ticket_type = 'walkin'
      then coalesce(es.walkin_use_ends_at, es.walkin_ends_at, es.ticket_use_ends_at, es.ends_at)
      else coalesce(es.reservation_use_ends_at, es.ticket_use_ends_at, es.ends_at)
    end,
    es.is_ticket_use_enabled
  into v_use_starts_at, v_use_ends_at, v_use_enabled
  from public.event_slots es
  where es.id = v_reservation.event_slot_id;

  if v_use_enabled is distinct from true then
    raise exception 'このチケットは使用不可に設定されています。';
  end if;

  if v_use_starts_at is not null and now() < v_use_starts_at then
    raise exception 'このチケットはまだ使用できません。';
  end if;

  if v_use_ends_at is not null and now() > v_use_ends_at then
    raise exception 'このチケットの使用可能時間は終了しました。';
  end if;

  update public.reservations
  set status = 'used', used_at = now(), used_by = auth.uid()
  where id = v_reservation.id and status = 'reserved'
  returning * into v_reservation;

  if not found then
    raise exception 'チケットはすでに使用されています。';
  end if;

  return json_build_object('status', v_reservation.status, 'used_at', v_reservation.used_at);
end;
$function$;

revoke execute on function public.use_ticket(text) from public, anon;
grant execute on function public.use_ticket(text) to authenticated;

-- 4. 自分のキャンセル済み予約（直近30日）
create or replace function public.get_my_cancelled_tickets()
returns table(
  reservation_id uuid,
  event_title text,
  slot_label text,
  slot_starts_at timestamptz,
  ticket_type text,
  payment_status text,
  cancelled_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.id, e.title, es.label, es.starts_at, r.ticket_type, r.payment_status, r.cancelled_at
    from public.reservations r
    join public.events e on e.id = r.event_id
    left join public.event_slots es on es.id = r.event_slot_id
   where r.user_id = auth.uid()
     and r.status = 'cancelled'
     and coalesce(r.cancelled_at, r.created_at) > now() - interval '30 days'
   order by r.cancelled_at desc nulls last
   limit 20;
$function$;

revoke execute on function public.get_my_cancelled_tickets() from public, anon;
grant execute on function public.get_my_cancelled_tickets() to authenticated;
