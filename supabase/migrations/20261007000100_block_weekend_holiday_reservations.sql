-- 企画ごとに「土日祝日は予約を受け付けない」をオンオフできるようにする。
-- オンのとき、予約する日（日本時間の暦日）が土日・祝日なら通常予約を拒否する。当日券は対象外。
-- 祝日は祝日法の規則から計算する（2022年以降が対象。春分・秋分は1980〜2099年の近似式）。

begin;

alter table public.events
  add column if not exists block_weekend_holiday_reservations boolean not null default false;

-- 祝日法で定める「国民の祝日」そのもの（振替休日・国民の休日は含まない）
create or replace function public.jp_statutory_holiday(p_date date)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  y int := extract(year from p_date)::int;
  m int := extract(month from p_date)::int;
  d int := extract(day from p_date)::int;
  dow int := extract(dow from p_date)::int; -- 0=日, 1=月
  nth int := (d - 1) / 7 + 1;               -- その月の第何週目の曜日か
begin
  if (m, d) in ((1, 1), (2, 11), (2, 23), (4, 29), (5, 3), (5, 4), (5, 5), (8, 11), (11, 3), (11, 23)) then
    return true;
  end if;
  -- ハッピーマンデー：成人の日・海の日・敬老の日・スポーツの日
  if dow = 1 and ((m = 1 and nth = 2) or (m = 7 and nth = 3) or (m = 9 and nth = 3) or (m = 10 and nth = 2)) then
    return true;
  end if;
  -- 春分の日・秋分の日
  if m = 3 and d = floor(20.8431 + 0.242194 * (y - 1980) - floor((y - 1980) / 4.0)) then
    return true;
  end if;
  if m = 9 and d = floor(23.2488 + 0.242194 * (y - 1980) - floor((y - 1980) / 4.0)) then
    return true;
  end if;
  return false;
end $$;

-- 振替休日・国民の休日を含めた祝日判定
create or replace function public.is_jp_holiday(p_date date)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v date;
begin
  if public.jp_statutory_holiday(p_date) then
    return true;
  end if;
  -- 振替休日：日曜の祝日から祝日が続いた後の最初の平日
  v := p_date - 1;
  while public.jp_statutory_holiday(v) loop
    if extract(dow from v) = 0 then
      return true;
    end if;
    v := v - 1;
  end loop;
  -- 国民の休日：前日と翌日が祝日の日
  return public.jp_statutory_holiday(p_date - 1) and public.jp_statutory_holiday(p_date + 1);
end $$;

create or replace function public.is_weekend_or_jp_holiday(p_date date)
returns boolean
language sql
immutable
set search_path = public
as $$
  select extract(isodow from p_date) >= 6 or public.is_jp_holiday(p_date);
$$;

-- 企画の設定がオンで、今日（日本時間）が土日祝日なら true
create or replace function public.reservation_closed_today(p_block boolean)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_block, false)
     and public.is_weekend_or_jp_holiday((now() at time zone 'Asia/Tokyo')::date);
$$;

-- 予約受付中の枠を、土日祝日は 'holiday_closed' として返す
create or replace function public.apply_reservation_day_block(p_status text, p_block boolean)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_status in ('available', 'low_remaining') and public.reservation_closed_today(p_block)
      then 'holiday_closed'
    else p_status
  end;
$$;

CREATE OR REPLACE FUNCTION public.create_reservation(p_event_id uuid, p_event_slot_id uuid, p_student_name text, p_student_number text, p_university_email text, p_department text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event public.events%ROWTYPE;
  v_slot public.event_slots%ROWTYPE;
  v_reservation public.reservations%ROWTYPE;
  v_student_number text;
  v_email text;
  v_domain text;
  v_reserved_count bigint;
  v_walkin_count bigint;
  v_pre_reserved_count bigint;
  v_pre_walkin_count bigint;
BEGIN
  IF p_student_name IS NULL OR btrim(p_student_name) = '' THEN
    RAISE EXCEPTION '氏名を入力してください。';
  END IF;

  v_student_number := upper(regexp_replace(btrim(COALESCE(p_student_number, '')), '\s+', '', 'g'));
  IF v_student_number LIKE 'S%' THEN
    v_student_number := substr(v_student_number, 2);
  END IF;
  v_email := lower(btrim(COALESCE(p_university_email, '')));

  IF v_student_number !~ '^[0-9]{2}[A-Z][0-9]{3}$' THEN
    RAISE EXCEPTION '学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)';
  END IF;
  IF split_part(v_email, '@', 1) <> 's' || lower(v_student_number) THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しません。';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_student_number, 0));

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.is_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION '企画が見つからないか、公開されていません。';
  END IF;
  IF v_event.reservation_enabled IS DISTINCT FROM true
     OR v_event.is_reservation_suspended IS TRUE
     OR (v_event.auto_suspend_at IS NOT NULL AND now() >= v_event.auto_suspend_at) THEN
    RAISE EXCEPTION '現在、予約受付を停止しています。';
  END IF;
  IF public.reservation_closed_today(v_event.block_weekend_holiday_reservations) THEN
    RAISE EXCEPTION '土日祝日は予約を受け付けていません。平日に予約してください。';
  END IF;

  v_domain := split_part(v_email, '@', 2);
  IF v_event.allowed_email_domains IS NOT NULL
     AND NOT (v_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) AS d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  SELECT * INTO v_slot
  FROM public.event_slots
  WHERE id = p_event_slot_id AND event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled OR NOT v_slot.is_reservation_enabled THEN
    RAISE EXCEPTION 'この枠の予約受付は現在停止しています。';
  END IF;
  IF v_slot.reservation_starts_at IS NOT NULL AND now() < v_slot.reservation_starts_at THEN
    RAISE EXCEPTION '予約開始日時前です。';
  END IF;
  IF v_slot.reservation_ends_at IS NOT NULL AND now() > v_slot.reservation_ends_at THEN
    RAISE EXCEPTION '予約終了日時を過ぎています。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.event_slot_id = p_event_slot_id
      AND (r.student_number = v_student_number OR r.university_email = v_email)
      AND r.status IN ('reserved','used')
      AND r.ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION 'この開催枠ではすでに当日券を取得しています。';
  END IF;

  IF v_event.slot_selection_mode = 'single' THEN
    IF EXISTS (
      SELECT 1
      FROM public.reservations r
      JOIN public.event_slots es ON es.id = r.event_slot_id
      WHERE es.event_id = p_event_id
        AND (r.student_number = v_student_number OR r.university_email = v_email)
        AND r.status IN ('reserved','used')
        AND r.ticket_type = 'reservation'
    ) THEN
      RAISE EXCEPTION 'この学籍番号またはメールアドレスは既にこの企画を予約しています。';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.event_slot_id = p_event_slot_id
        AND (r.student_number = v_student_number OR r.university_email = v_email)
        AND r.status IN ('reserved','used')
        AND r.ticket_type = 'reservation'
    ) THEN
      RAISE EXCEPTION 'この開催枠は既に予約済みです。';
    END IF;
  END IF;

  SELECT count(*) INTO v_reserved_count FROM public.reservations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','used') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_walkin_count FROM public.reservations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','used') AND ticket_type = 'walkin';
  SELECT count(*) INTO v_pre_reserved_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status = 'reserved' AND ticket_type = 'reservation';
  SELECT count(*) INTO v_pre_walkin_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status = 'reserved' AND ticket_type = 'walkin';

  IF v_reserved_count + v_pre_reserved_count >= v_slot.reservation_capacity THEN
    RAISE EXCEPTION '予約枠の定員に達しました。';
  END IF;
  IF v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO public.reservations (
    event_id, event_slot_id, student_name, student_number,
    university_email, department, ticket_type, status
  ) VALUES (
    p_event_id, p_event_slot_id, btrim(p_student_name), v_student_number,
    v_email, NULLIF(btrim(p_department), ''), 'reservation', 'reserved'
  ) RETURNING * INTO v_reservation;

  RETURN jsonb_build_object(
    'id', v_reservation.id,
    'event_id', v_reservation.event_id,
    'event_slot_id', v_reservation.event_slot_id,
    'ticket_code', v_reservation.ticket_code,
    'public_token', v_reservation.public_token,
    'status', v_reservation.status,
    'created_at', v_reservation.created_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_reservations_bulk(p_event_id uuid, p_event_slot_ids uuid[], p_student_name text, p_student_number text, p_university_email text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event record;
  v_slot record;
  v_normalized_student_number text;
  v_normalized_email text;
  v_email_domain text;
  v_public_token text;
  v_ticket_code text;
  v_new_reservation record;
  v_slot_id uuid;
  v_results json[];
  v_unique_slot_ids uuid[];
  v_active_reserved_count bigint;
  v_active_walkin_count bigint;
  v_pre_reserved_count bigint;
  v_pre_walkin_count bigint;
BEGIN
  IF p_event_slot_ids IS NULL OR array_length(p_event_slot_ids, 1) IS NULL OR array_length(p_event_slot_ids, 1) = 0 THEN
    RAISE EXCEPTION '開催枠を1つ以上選択してください。';
  END IF;

  SELECT array_agg(DISTINCT s) INTO v_unique_slot_ids FROM unnest(p_event_slot_ids) s;
  IF array_length(v_unique_slot_ids, 1) != array_length(p_event_slot_ids, 1) THEN
    RAISE EXCEPTION '同じ開催枠が重複して選択されています。';
  END IF;

  v_normalized_student_number := upper(trim(p_student_number));
  IF v_normalized_student_number LIKE 'S%' THEN
    v_normalized_student_number := substring(v_normalized_student_number from 2);
  END IF;
  v_normalized_email := lower(trim(p_university_email));

  IF p_student_name IS NULL OR trim(p_student_name) = '' THEN
    RAISE EXCEPTION '氏名を入力してください。';
  END IF;
  IF v_normalized_student_number = '' THEN
    RAISE EXCEPTION '学籍番号を入力してください。';
  END IF;
  IF v_normalized_email = '' THEN
    RAISE EXCEPTION 'メールアドレスを入力してください。';
  END IF;

  IF NOT (v_normalized_student_number ~ '^\d{2}[A-Z]\d{3}$') THEN
    RAISE EXCEPTION '学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)';
  END IF;

  IF split_part(v_normalized_email, '@', 1) != 's' || lower(v_normalized_student_number) THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しません。';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_event_id::text || ':' || v_normalized_student_number,
      0
    )
  );

  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
  END IF;

  IF v_event.is_reservation_suspended OR (v_event.auto_suspend_at IS NOT NULL AND now() >= v_event.auto_suspend_at) THEN
    RAISE EXCEPTION '現在、予約受付を一時停止しています。';
  END IF;

  IF public.reservation_closed_today(v_event.block_weekend_holiday_reservations) THEN
    RAISE EXCEPTION '土日祝日は予約を受け付けていません。平日に予約してください。';
  END IF;

  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  IF v_event.slot_selection_mode = 'single' THEN
    IF array_length(p_event_slot_ids, 1) > 1 THEN
      RAISE EXCEPTION 'この企画は1枠のみ予約可能です。';
    END IF;
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND (r.student_number = v_normalized_student_number OR r.university_email = v_normalized_email)
        AND r.status IN ('reserved', 'used')
        AND r.ticket_type = 'reservation'
    ) THEN
      RAISE EXCEPTION 'この学籍番号またはメールアドレスは既にこの企画を予約しています。';
    END IF;
  END IF;

  FOR v_slot IN
    SELECT * FROM event_slots
    WHERE id = ANY(p_event_slot_ids) AND event_id = p_event_id
    ORDER BY id
    FOR UPDATE
  LOOP
  END LOOP;

  IF (SELECT count(*) FROM event_slots WHERE id = ANY(p_event_slot_ids) AND event_id = p_event_id) != array_length(p_event_slot_ids, 1) THEN
    RAISE EXCEPTION '指定された開催枠の一部が見つからないか、この企画に属していません。';
  END IF;

  v_results := ARRAY[]::json[];

  FOREACH v_slot_id IN ARRAY p_event_slot_ids
  LOOP
    SELECT * INTO v_slot FROM event_slots WHERE id = v_slot_id;

    IF NOT v_slot.is_enabled THEN
      RAISE EXCEPTION '開催枠「%」は現在受付停止中です。', v_slot.label;
    END IF;

    IF NOT v_slot.is_reservation_enabled THEN
      RAISE EXCEPTION '開催枠「%」は通常予約の受付期間外です。', v_slot.label;
    END IF;
    IF v_slot.reservation_starts_at IS NOT NULL AND now() < v_slot.reservation_starts_at THEN
      RAISE EXCEPTION '開催枠「%」は通常予約の受付期間外です。', v_slot.label;
    END IF;
    IF v_slot.reservation_ends_at IS NOT NULL AND now() > v_slot.reservation_ends_at THEN
      RAISE EXCEPTION '開催枠「%」は通常予約の受付期間外です。', v_slot.label;
    END IF;

    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = v_slot_id
        AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
        AND status IN ('reserved', 'used')
        AND ticket_type = 'walkin'
    ) THEN
      RAISE EXCEPTION '当日券取得済み：開催枠「%」はすでに当日券を取得しているため、予約券は取得できません。', v_slot.label;
    END IF;

    SELECT count(*) INTO v_active_reserved_count
    FROM reservations
    WHERE event_slot_id = v_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'reservation';

    SELECT count(*) INTO v_active_walkin_count
    FROM reservations
    WHERE event_slot_id = v_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'walkin';

    SELECT count(*) INTO v_pre_reserved_count
    FROM admin_pre_registrations
    WHERE event_slot_id = v_slot_id AND status = 'reserved' AND ticket_type = 'reservation';

    SELECT count(*) INTO v_pre_walkin_count
    FROM admin_pre_registrations
    WHERE event_slot_id = v_slot_id AND status = 'reserved' AND ticket_type = 'walkin';

    IF (v_active_reserved_count + v_pre_reserved_count) >= v_slot.reservation_capacity THEN
      RAISE EXCEPTION '開催枠「%」は予約券が定員に達しています。', v_slot.label;
    END IF;

    IF (v_active_reserved_count + v_pre_reserved_count + v_active_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
      RAISE EXCEPTION '開催枠「%」は全体の定員に達しています。', v_slot.label;
    END IF;

    IF v_event.slot_selection_mode = 'multiple' THEN
      IF EXISTS (
        SELECT 1 FROM reservations
        WHERE event_slot_id = v_slot_id
          AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
          AND status IN ('reserved', 'used')
          AND ticket_type = 'reservation'
      ) THEN
        RAISE EXCEPTION '開催枠「%」は既に予約済みです。', v_slot.label;
      END IF;
    END IF;

    v_public_token := gen_random_uuid()::text;
    LOOP
      v_ticket_code := upper(substring(md5(random()::text) from 1 for 8));
      IF NOT EXISTS (SELECT 1 FROM reservations WHERE ticket_code = v_ticket_code) THEN
        EXIT;
      END IF;
    END LOOP;

    INSERT INTO reservations (
      event_id, event_slot_id, student_name, student_number,
      university_email, ticket_code, public_token, status, ticket_type
    ) VALUES (
      p_event_id, v_slot_id, trim(p_student_name), v_normalized_student_number,
      v_normalized_email, v_ticket_code, v_public_token, 'reserved', 'reservation'
    ) RETURNING * INTO v_new_reservation;

    v_results := array_append(v_results, json_build_object(
      'id', v_new_reservation.id,
      'event_id', v_new_reservation.event_id,
      'event_slot_id', v_new_reservation.event_slot_id,
      'slot_label', v_slot.label,
      'student_name', v_new_reservation.student_name,
      'student_number', v_new_reservation.student_number,
      'ticket_code', v_new_reservation.ticket_code,
      'public_token', v_new_reservation.public_token,
      'status', v_new_reservation.status,
      'ticket_type', v_new_reservation.ticket_type,
      'created_at', v_new_reservation.created_at
    ));
  END LOOP;

  PERFORM admin_auto_activate_pre_registrations(p_event_id);

  RETURN array_to_json(v_results);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_event_slots(p_event_id uuid)
 RETURNS TABLE(id uuid, label text, starts_at timestamp with time zone, ends_at timestamp with time zone, is_enabled boolean, sort_order integer, total_capacity integer, reservation_capacity integer, reserved_count bigint, walkin_count bigint, remaining_reservation_slots bigint, remaining_walkin_slots bigint, reservation_starts_at timestamp with time zone, reservation_ends_at timestamp with time zone, ticket_use_starts_at timestamp with time zone, ticket_use_ends_at timestamp with time zone, walkin_starts_at timestamp with time zone, walkin_ends_at timestamp with time zone, is_reservation_enabled boolean, is_ticket_use_enabled boolean, is_walkin_enabled boolean, walkin_limit integer, capacity integer, remaining_slots bigint, reservation_use_starts_at timestamp with time zone, reservation_use_ends_at timestamp with time zone, walkin_use_starts_at timestamp with time zone, walkin_use_ends_at timestamp with time zone, reservation_status text, walkin_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH slots_data AS (
    SELECT
      es.id,
      es.label,
      es.starts_at,
      es.ends_at,
      es.is_enabled,
      es.sort_order,
      es.total_capacity,
      es.reservation_capacity,
      es.reservation_starts_at,
      es.reservation_ends_at,
      es.ticket_use_starts_at,
      es.ticket_use_ends_at,
      es.walkin_starts_at,
      es.walkin_ends_at,
      es.is_reservation_enabled,
      es.is_ticket_use_enabled,
      es.is_walkin_enabled,
      es.walkin_limit,
      es.created_at,
      e.is_reservation_suspended,
      e.is_walkin_suspended,
      e.auto_suspend_at,
      e.block_weekend_holiday_reservations,
      COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10) AS resolved_low_remaining_threshold,
      COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count') AS resolved_low_remaining_threshold_type,
      (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0))::bigint AS reserved_count_val,
      (COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))::bigint AS walkin_count_val,
      GREATEST(LEAST(
        es.reservation_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0)),
        es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))
      ), 0)::bigint AS rem_res_slots,
      GREATEST(LEAST(
        COALESCE(es.walkin_limit, es.total_capacity) - (COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0)),
        es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))
      ), 0)::bigint AS rem_walkin_slots
    FROM event_slots es
    JOIN events e ON es.event_id = e.id
    LEFT JOIN (
      SELECT
        event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
      FROM reservations
      GROUP BY event_slot_id
    ) res ON es.id = res.event_slot_id
    LEFT JOIN (
      SELECT
        event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'activation_failed') AND ticket_type = 'reservation') AS pre_res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'activation_failed') AND ticket_type = 'walkin') AS pre_walk_count
      FROM admin_pre_registrations
      GROUP BY event_slot_id
    ) pre ON es.id = pre.event_slot_id
    WHERE es.event_id = p_event_id
  )
  SELECT
    sd.id,
    sd.label,
    sd.starts_at,
    sd.ends_at,
    sd.is_enabled,
    sd.sort_order,
    sd.total_capacity,
    sd.reservation_capacity,
    sd.reserved_count_val AS reserved_count,
    sd.walkin_count_val AS walkin_count,
    sd.rem_res_slots AS remaining_reservation_slots,
    sd.rem_walkin_slots AS remaining_walkin_slots,
    sd.reservation_starts_at,
    sd.reservation_ends_at,
    sd.ticket_use_starts_at,
    sd.ticket_use_ends_at,
    sd.walkin_starts_at,
    sd.walkin_ends_at,
    sd.is_reservation_enabled,
    sd.is_ticket_use_enabled,
    sd.is_walkin_enabled,
    sd.walkin_limit,
    sd.reservation_capacity AS capacity,
    GREATEST(
      sd.total_capacity - (sd.reserved_count_val + sd.walkin_count_val),
      0
    )::bigint AS remaining_slots,
    sd.ticket_use_starts_at AS reservation_use_starts_at,
    sd.ticket_use_ends_at AS reservation_use_ends_at,
    sd.walkin_starts_at AS walkin_use_starts_at,
    sd.walkin_ends_at AS walkin_use_ends_at,
    apply_reservation_day_block(
      calculate_slot_status(
        sd.is_enabled, sd.is_reservation_enabled, sd.reservation_starts_at, sd.reservation_ends_at,
        LEAST(sd.reservation_capacity, sd.total_capacity),
        (LEAST(sd.reservation_capacity, sd.total_capacity) - sd.rem_res_slots)::bigint,
        sd.resolved_low_remaining_threshold,
        sd.resolved_low_remaining_threshold_type,
        'reservation', sd.is_reservation_suspended, sd.auto_suspend_at
      ),
      sd.block_weekend_holiday_reservations
    ) AS reservation_status,
    calculate_slot_status(
      sd.is_enabled, sd.is_walkin_enabled, sd.walkin_starts_at, sd.walkin_ends_at,
      LEAST(COALESCE(sd.walkin_limit, sd.total_capacity), sd.total_capacity),
      (LEAST(COALESCE(sd.walkin_limit, sd.total_capacity), sd.total_capacity) - sd.rem_walkin_slots)::bigint,
      sd.resolved_low_remaining_threshold,
      sd.resolved_low_remaining_threshold_type,
      'walkin', sd.is_walkin_suspended, sd.auto_suspend_at
    ) AS walkin_status
  FROM slots_data sd
  ORDER BY sd.sort_order, sd.starts_at, sd.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_events()
 RETURNS TABLE(id uuid, title text, description text, starts_at timestamp with time zone, ends_at timestamp with time zone, reservation_starts_at timestamp with time zone, reservation_ends_at timestamp with time zone, reservation_enabled boolean, ticket_enabled boolean, use_button_enabled boolean, use_starts_at timestamp with time zone, use_ends_at timestamp with time zone, allowed_email_domains text[], slot_selection_mode text, created_at timestamp with time zone, has_walkin_active boolean, has_walkin_upcoming boolean, slots jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    e.id, e.title, e.description, e.starts_at, e.ends_at,
    e.reservation_starts_at, e.reservation_ends_at, e.reservation_enabled,
    e.ticket_enabled, e.use_button_enabled, e.use_starts_at, e.use_ends_at,
    e.allowed_email_domains, e.slot_selection_mode, e.created_at,
    COALESCE(slot_stats.has_walkin_active, false) AS has_walkin_active,
    COALESCE(slot_stats.has_walkin_upcoming, false) AS has_walkin_upcoming,
    COALESCE(slot_stats.slots_json, '[]'::jsonb) AS slots
  FROM events e
  LEFT JOIN (
    SELECT
      es.event_id,
      COALESCE(bool_or(es.is_enabled = true AND es.is_walkin_enabled = true AND (es.walkin_starts_at IS NULL OR now() >= es.walkin_starts_at) AND (es.walkin_ends_at IS NULL OR now() <= es.walkin_ends_at) AND e.is_walkin_suspended = false AND (e.auto_suspend_at IS NULL OR now() < e.auto_suspend_at)), false) AS has_walkin_active,
      COALESCE(bool_or(es.is_enabled = true AND es.is_walkin_enabled = true AND es.walkin_starts_at IS NOT NULL AND now() < es.walkin_starts_at AND e.is_walkin_suspended = false AND (e.auto_suspend_at IS NULL OR now() < e.auto_suspend_at)), false) AS has_walkin_upcoming,
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'label', es.label,
          'starts_at', es.starts_at,
          'ends_at', es.ends_at,
          'is_enabled', es.is_enabled,
          'reservation_status', apply_reservation_day_block(
            calculate_slot_status(
              es.is_enabled, es.is_reservation_enabled, es.reservation_starts_at, es.reservation_ends_at,
              LEAST(es.reservation_capacity, es.total_capacity),
              (LEAST(es.reservation_capacity, es.total_capacity) - GREATEST(LEAST(
                es.reservation_capacity - (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0)),
                es.total_capacity - (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0) + COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0))
              ), 0))::bigint,
              COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
              COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
              'reservation', e.is_reservation_suspended, e.auto_suspend_at
            ),
            e.block_weekend_holiday_reservations
          ),
          'walkin_status', calculate_slot_status(
            es.is_enabled, es.is_walkin_enabled, es.walkin_starts_at, es.walkin_ends_at,
            LEAST(COALESCE(es.walkin_limit, es.total_capacity), es.total_capacity),
            (LEAST(COALESCE(es.walkin_limit, es.total_capacity), es.total_capacity) - GREATEST(LEAST(
              COALESCE(es.walkin_limit, es.total_capacity) - (COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0)),
              es.total_capacity - (COALESCE(r_counts.res_count, 0) + COALESCE(p_counts.pre_res_count, 0) + COALESCE(r_counts.walk_count, 0) + COALESCE(p_counts.pre_walk_count, 0))
            ), 0))::bigint,
            COALESCE(es.low_remaining_threshold, e.low_remaining_threshold, 10),
            COALESCE(es.low_remaining_threshold_type, e.low_remaining_threshold_type, 'count'),
            'walkin', e.is_walkin_suspended, e.auto_suspend_at
          )
        ) ORDER BY es.sort_order, es.starts_at, es.created_at
      ) AS slots_json
    FROM event_slots es
    JOIN events e ON es.event_id = e.id
    LEFT JOIN (
      SELECT event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
      FROM reservations GROUP BY event_slot_id
    ) r_counts ON es.id = r_counts.event_slot_id
    LEFT JOIN (
      SELECT event_slot_id,
        count(*) FILTER (WHERE status = 'reserved' AND ticket_type = 'reservation') AS pre_res_count,
        count(*) FILTER (WHERE status = 'reserved' AND ticket_type = 'walkin') AS pre_walk_count
      FROM admin_pre_registrations GROUP BY event_slot_id
    ) p_counts ON es.id = p_counts.event_slot_id
    WHERE es.is_enabled = true
    GROUP BY es.event_id
  ) slot_stats ON e.id = slot_stats.event_id
  WHERE e.is_public = true AND (e.auto_hide_at IS NULL OR now() < e.auto_hide_at)
  ORDER BY e.created_at DESC;
END;
$function$;

notify pgrst, 'reload schema';

commit;
