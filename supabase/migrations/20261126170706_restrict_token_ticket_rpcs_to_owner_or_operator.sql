-- public_token だけで他人のチケットを操作・閲覧できないようにする（2026-11-26）
--
-- 背景:
--   スタッフ確定方式の支払いでは、学生の「自分の予約」画面に public_token 入りのQR
--   （/staff?r=<public_token>）を大きく表示する。列に並んでいる他の人が撮影すると、
--   これまでは use_ticket(text) で他人のチケットを使用済みにしたり、get_ticket(text) で
--   氏名・学籍番号を読んだりできた（ログインさえしていれば誰でも呼べたため）。
--
-- 変更:
--   use_ticket(text) / get_ticket(text) / get_ticket_payment_state(text) は、
--   予約の本人（reservations.user_id = auth.uid()）か、その企画を運営できる人
--   （public.can_operate_event(event_id)：管理者または担当企画のスタッフ）だけが使える。
--   それ以外の人には「見つからない」と同じ結果を返し、予約の有無を区別させない。
--
-- 互換性:
--   - 関数名・引数・戻り値は変えない（AGENTS.md の get_ticket(text) 契約はそのまま）。
--   - use_my_ticket(uuid) は本人確認のあと use_ticket(text) を呼ぶので、本人の使用は従来どおり。
--   - 画面（src/）は use_ticket / get_ticket を直接呼んでいない。/ticket?token= は
--     get_my_reservation_id_by_token（本人のみ）を使う。「チケットを探す」は 2026-11-14 に廃止済み。
--   - can_operate_event は service_role 以外に EXECUTE 権限がないが、これらは SECURITY DEFINER
--     （所有者 postgres）なので内部から呼べる。

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

  -- 本人か、その企画を運営できる人（管理者・担当スタッフ）だけが使用済みにできる。
  -- それ以外は「見つからない」と同じ扱いにして、トークンが有効かどうかを漏らさない。
  if v_reservation.user_id is distinct from auth.uid()
     and not public.can_operate_event(v_reservation.event_id) then
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

create or replace function public.get_ticket(p_public_token text)
returns table(
  reservation_id uuid, student_name text, student_number text, status text, ticket_type text,
  ticket_code text, public_token text, used_at timestamptz, cancelled_at timestamptz, created_at timestamptz,
  event_id uuid, event_title text, event_description text, event_starts_at timestamptz, event_ends_at timestamptz,
  use_starts_at timestamptz, use_ends_at timestamptz, ticket_enabled boolean, use_button_enabled boolean,
  ticket_reveal_minutes integer,
  survey_after_reservation_enabled boolean, survey_after_reservation_url text, survey_after_reservation_message text,
  survey_after_use_enabled boolean, survey_after_use_url text, survey_after_use_message text,
  post_reservation_notes text, is_ticket_use_suspended boolean, auto_suspend_at timestamptz,
  slot_id uuid, slot_label text, slot_starts_at timestamptz, slot_ends_at timestamptz,
  slot_reservation_starts_at timestamptz, slot_reservation_ends_at timestamptz,
  slot_ticket_use_starts_at timestamptz, slot_ticket_use_ends_at timestamptz,
  slot_walkin_starts_at timestamptz, slot_walkin_ends_at timestamptz,
  slot_is_reservation_enabled boolean, slot_is_ticket_use_enabled boolean, slot_is_walkin_enabled boolean,
  slot_reservation_use_starts_at timestamptz, slot_reservation_use_ends_at timestamptz,
  slot_walkin_use_starts_at timestamptz, slot_walkin_use_ends_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_id uuid;
  v_user_id uuid;
begin
  if auth.uid() is null then
    return;
  end if;

  select r.event_id, r.user_id
  into v_event_id, v_user_id
  from public.reservations r
  where r.public_token = p_public_token;

  -- 本人か、その企画を運営できる人（管理者・担当スタッフ）以外には何も返さない
  -- （氏名・学籍番号を含むため。予約が存在しない場合と区別させない）。
  if v_event_id is null
     or (v_user_id is distinct from auth.uid() and not public.can_operate_event(v_event_id)) then
    return;
  end if;

  perform public.admin_auto_activate_pre_registrations(v_event_id);

  return query
  select
    r.id, r.student_name, r.student_number, r.status, r.ticket_type, r.ticket_code, r.public_token,
    r.used_at, r.cancelled_at, r.created_at,
    e.id, e.title, e.description, e.starts_at, e.ends_at, e.use_starts_at, e.use_ends_at,
    e.ticket_enabled, e.use_button_enabled, e.ticket_reveal_minutes,
    e.survey_after_reservation_enabled, e.survey_after_reservation_url, e.survey_after_reservation_message,
    e.survey_after_use_enabled, e.survey_after_use_url, e.survey_after_use_message,
    e.post_reservation_notes, e.is_ticket_use_suspended, e.auto_suspend_at,
    es.id, es.label, es.starts_at, es.ends_at,
    es.reservation_starts_at, es.reservation_ends_at, es.ticket_use_starts_at, es.ticket_use_ends_at,
    es.walkin_starts_at, es.walkin_ends_at,
    es.is_reservation_enabled, es.is_ticket_use_enabled, es.is_walkin_enabled,
    es.reservation_use_starts_at, es.reservation_use_ends_at, es.walkin_use_starts_at, es.walkin_use_ends_at
  from public.reservations r
  join public.events e on e.id = r.event_id
  left join public.event_slots es on es.id = r.event_slot_id
  where r.public_token = p_public_token
    and (r.user_id = auth.uid() or public.can_operate_event(r.event_id))
    and not public.is_user_blacklisted(r.student_number, r.university_email)
    and (
      case when r.ticket_type = 'walkin'
        then coalesce(es.walkin_use_ends_at, es.walkin_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
        else coalesce(es.reservation_use_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
      end is null
      or now() <= case when r.ticket_type = 'walkin'
        then coalesce(es.walkin_use_ends_at, es.walkin_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
        else coalesce(es.reservation_use_ends_at, es.ticket_use_ends_at, e.use_ends_at, es.ends_at)
      end
    );
end;
$function$;

create or replace function public.get_ticket_payment_state(p_public_token text)
returns table(payment_required boolean, payment_status text, payment_due_at timestamptz, paid_at timestamptz)
language sql
security definer
set search_path to 'public'
as $function$
  select
    e.payment_required,
    r.payment_status,
    r.payment_due_at,
    r.paid_at
  from public.reservations r
  join public.events e on e.id = r.event_id
  where r.public_token = p_public_token
    and auth.uid() is not null
    and (r.user_id = auth.uid() or public.can_operate_event(r.event_id))
  limit 1;
$function$;

-- 権限は従来どおり（ログイン中の利用者のみ。匿名には公開しない）
revoke execute on function public.use_ticket(text) from public, anon;
revoke execute on function public.get_ticket(text) from public, anon;
revoke execute on function public.get_ticket_payment_state(text) from public, anon;
grant execute on function public.use_ticket(text) to authenticated;
grant execute on function public.get_ticket(text) to authenticated;
grant execute on function public.get_ticket_payment_state(text) to authenticated;
