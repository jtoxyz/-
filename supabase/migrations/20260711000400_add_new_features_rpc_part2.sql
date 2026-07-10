-- Update create_reservations_bulk
CREATE OR REPLACE FUNCTION create_reservations_bulk(
  p_event_id uuid,
  p_event_slot_ids uuid[],
  p_student_name text,
  p_student_number text,
  p_university_email text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE event_slot_id = v_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation';
  
    SELECT count(*) INTO v_pre_walkin_count
    FROM admin_pre_registrations
    WHERE event_slot_id = v_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin';

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
$$;


-- Update get_ticket
DROP FUNCTION IF EXISTS get_ticket(text);
CREATE OR REPLACE FUNCTION get_ticket(
  p_public_token text
)
RETURNS TABLE (
  reservation_id uuid,
  student_name text,
  student_number text,
  status text,
  ticket_type text,
  ticket_code text,
  public_token text,
  used_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz,
  event_id uuid,
  event_title text,
  event_description text,
  event_starts_at timestamptz,
  event_ends_at timestamptz,
  use_starts_at timestamptz,
  use_ends_at timestamptz,
  ticket_enabled boolean,
  use_button_enabled boolean,
  survey_after_reservation_enabled boolean,
  survey_after_reservation_url text,
  survey_after_reservation_message text,
  survey_after_use_enabled boolean,
  survey_after_use_url text,
  survey_after_use_message text,
  post_reservation_notes text,
  is_ticket_use_suspended boolean,
  auto_suspend_at timestamptz,
  slot_id uuid,
  slot_label text,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz,
  slot_reservation_starts_at timestamptz,
  slot_reservation_ends_at timestamptz,
  slot_ticket_use_starts_at timestamptz,
  slot_ticket_use_ends_at timestamptz,
  slot_walkin_starts_at timestamptz,
  slot_walkin_ends_at timestamptz,
  slot_is_reservation_enabled boolean,
  slot_is_ticket_use_enabled boolean,
  slot_is_walkin_enabled boolean,
  -- compatibility aliases
  slot_reservation_use_starts_at timestamptz,
  slot_reservation_use_ends_at timestamptz,
  slot_walkin_use_starts_at timestamptz,
  slot_walkin_use_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Perform lazy activation check when ticket is loaded
  PERFORM admin_auto_activate_pre_registrations((SELECT event_id FROM reservations WHERE public_token = p_public_token));

  RETURN QUERY
  SELECT
    r.id AS reservation_id,
    r.student_name,
    r.student_number,
    r.status,
    r.ticket_type,
    r.ticket_code,
    r.public_token,
    r.used_at,
    r.cancelled_at,
    r.created_at,
    e.id AS event_id,
    e.title AS event_title,
    e.description AS event_description,
    e.starts_at AS event_starts_at,
    e.ends_at AS event_ends_at,
    e.use_starts_at AS use_starts_at,
    e.use_ends_at AS use_ends_at,
    e.ticket_enabled,
    e.use_button_enabled,
    e.survey_after_reservation_enabled,
    e.survey_after_reservation_url,
    e.survey_after_reservation_message,
    e.survey_after_use_enabled,
    e.survey_after_use_url,
    e.survey_after_use_message,
    e.post_reservation_notes,
    e.is_ticket_use_suspended,
    e.auto_suspend_at,
    es.id AS slot_id,
    es.label AS slot_label,
    es.starts_at AS slot_starts_at,
    es.ends_at AS slot_ends_at,
    es.reservation_starts_at AS slot_reservation_starts_at,
    es.reservation_ends_at AS slot_reservation_ends_at,
    es.ticket_use_starts_at AS slot_ticket_use_starts_at,
    es.ticket_use_ends_at AS slot_ticket_use_ends_at,
    es.walkin_starts_at AS slot_walkin_starts_at,
    es.walkin_ends_at AS slot_walkin_ends_at,
    es.is_reservation_enabled AS slot_is_reservation_enabled,
    es.is_ticket_use_enabled AS slot_is_ticket_use_enabled,
    es.is_walkin_enabled AS slot_is_walkin_enabled,
    -- compatibility
    es.ticket_use_starts_at AS slot_reservation_use_starts_at,
    es.ticket_use_ends_at AS slot_reservation_use_ends_at,
    es.walkin_starts_at AS slot_walkin_use_starts_at,
    es.walkin_ends_at AS slot_walkin_use_ends_at
  FROM reservations r
  JOIN events e ON r.event_id = e.id
  LEFT JOIN event_slots es ON r.event_slot_id = es.id
  WHERE r.public_token = p_public_token;
END;
$$;
