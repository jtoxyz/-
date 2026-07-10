-- Migration: 20260711_fix_capacity_logic.sql
-- Fixes capacity logic to strictly enforce 3 separate rules.

-- 1. get_event_slots
DROP FUNCTION IF EXISTS get_event_slots(uuid);
CREATE OR REPLACE FUNCTION get_event_slots(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  label text,
  starts_at timestamptz,
  ends_at timestamptz,
  is_enabled boolean,
  sort_order integer,
  total_capacity integer,
  reservation_capacity integer,
  reserved_count bigint,
  walkin_count bigint,
  remaining_reservation_slots bigint,
  remaining_walkin_slots bigint,
  reservation_starts_at timestamptz,
  reservation_ends_at timestamptz,
  ticket_use_starts_at timestamptz,
  ticket_use_ends_at timestamptz,
  walkin_starts_at timestamptz,
  walkin_ends_at timestamptz,
  is_reservation_enabled boolean,
  is_ticket_use_enabled boolean,
  is_walkin_enabled boolean,
  walkin_limit integer,
  -- Backwards compatibility aliases
  capacity integer,
  remaining_slots bigint,
  reservation_use_starts_at timestamptz,
  reservation_use_ends_at timestamptz,
  walkin_use_starts_at timestamptz,
  walkin_use_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    es.id,
    es.label,
    es.starts_at,
    es.ends_at,
    es.is_enabled,
    es.sort_order,
    es.total_capacity,
    es.reservation_capacity,
    (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0))::bigint AS reserved_count,
    (COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))::bigint AS walkin_count,
    GREATEST(LEAST(
      es.reservation_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0)), 
      es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))
    ), 0)::bigint AS remaining_reservation_slots,
    GREATEST(LEAST(
      COALESCE(es.walkin_limit, es.total_capacity) - (COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0)),
      es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0))
    ), 0)::bigint AS remaining_walkin_slots,
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
    -- Backwards compatibility
    es.reservation_capacity AS capacity,
    GREATEST(
      es.total_capacity - (COALESCE(res.res_count, 0) + COALESCE(pre.pre_res_count, 0) + COALESCE(res.walk_count, 0) + COALESCE(pre.pre_walk_count, 0)), 
      0
    )::bigint AS remaining_slots,
    es.ticket_use_starts_at AS reservation_use_starts_at,
    es.ticket_use_ends_at AS reservation_use_ends_at,
    es.walkin_starts_at AS walkin_use_starts_at,
    es.walkin_ends_at AS walkin_use_ends_at
  FROM event_slots es
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
      count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS pre_res_count,
      count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS pre_walk_count
    FROM admin_pre_registrations
    GROUP BY event_slot_id
  ) pre ON es.id = pre.event_slot_id
  WHERE es.event_id = p_event_id
  ORDER BY es.sort_order, es.starts_at, es.created_at;
END;
$$;


-- 2. create_reservation
DROP FUNCTION IF EXISTS create_reservation(uuid, uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION create_reservation(
  p_event_id uuid,
  p_event_slot_id uuid,
  p_student_name text,
  p_student_number text,
  p_university_email text,
  p_department text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reservation_id uuid;
  v_slot record;
  v_reserved_count integer;
  v_walkin_count integer;
  v_pre_reserved_count integer;
  v_pre_walkin_count integer;
BEGIN
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id;
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

  SELECT count(*) INTO v_reserved_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';

  SELECT count(*) INTO v_walkin_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  SELECT count(*) INTO v_pre_reserved_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';

  SELECT count(*) INTO v_pre_walkin_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  -- Rule 1: Reservation capacity check
  IF (v_reserved_count + v_pre_reserved_count) >= COALESCE(v_slot.reservation_capacity, v_slot.total_capacity) THEN
    RAISE EXCEPTION '予約枠の定員に達しました。';
  END IF;

  -- Rule 3: Total capacity check
  IF (v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO reservations (
    event_id,
    event_slot_id,
    student_name,
    student_number,
    university_email,
    department,
    ticket_type,
    status
  ) VALUES (
    p_event_id,
    p_event_slot_id,
    p_student_name,
    p_student_number,
    p_university_email,
    p_department,
    'reservation',
    'reserved'
  ) RETURNING id INTO v_reservation_id;

  RETURN v_reservation_id;
END;
$$;


-- 3. create_walkin_reservation
DROP FUNCTION IF EXISTS create_walkin_reservation(uuid, uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION create_walkin_reservation(
  p_event_id uuid,
  p_event_slot_id uuid,
  p_student_name text,
  p_student_number text,
  p_university_email text,
  p_department text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_reservation_id uuid;
  v_public_token text;
  v_slot record;
  v_active_reserved_count integer;
  v_active_walkin_count integer;
  v_pre_reserved_count integer;
  v_pre_walkin_count integer;
BEGIN
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '開催枠が見つかりません。';
  END IF;

  IF NOT v_slot.is_enabled OR NOT v_slot.is_walkin_enabled THEN
    RAISE EXCEPTION 'この枠の当日券発行は現在停止しています。';
  END IF;

  IF v_slot.walkin_starts_at IS NOT NULL AND now() < v_slot.walkin_starts_at THEN
    RAISE EXCEPTION '当日券発行開始日時前です。';
  END IF;

  IF v_slot.walkin_ends_at IS NOT NULL AND now() > v_slot.walkin_ends_at THEN
    RAISE EXCEPTION '当日券発行終了日時を過ぎています。';
  END IF;

  SELECT count(*) INTO v_active_reserved_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';

  SELECT count(*) INTO v_active_walkin_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  SELECT count(*) INTO v_pre_reserved_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';

  SELECT count(*) INTO v_pre_walkin_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  -- Rule 2: Walkin capacity check
  IF (v_active_walkin_count + v_pre_walkin_count) >= COALESCE(v_slot.walkin_limit, v_slot.total_capacity) THEN
    RAISE EXCEPTION '当日券の発行上限に達しました。';
  END IF;

  -- Rule 3: Total capacity check
  IF (v_active_reserved_count + v_pre_reserved_count + v_active_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO reservations (
    event_id,
    event_slot_id,
    student_name,
    student_number,
    university_email,
    department,
    ticket_type,
    status
  ) VALUES (
    p_event_id,
    p_event_slot_id,
    p_student_name,
    p_student_number,
    p_university_email,
    p_department,
    'walkin',
    'reserved'
  ) RETURNING id, public_token INTO v_reservation_id, v_public_token;

  RETURN jsonb_build_object('id', v_reservation_id, 'publicToken', v_public_token);
END;
$$;


-- 4. admin_create_pre_registration
DROP FUNCTION IF EXISTS admin_create_pre_registration(uuid, uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION admin_create_pre_registration(
  p_event_id uuid,
  p_event_slot_id uuid,
  p_student_name text,
  p_student_number text,
  p_university_email text,
  p_ticket_type text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id uuid;
  v_slot record;
  v_reserved_count integer;
  v_walkin_count integer;
  v_pre_reserved_count integer;
  v_pre_walkin_count integer;
BEGIN
  -- Authenticate admin
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid()) THEN
    RAISE EXCEPTION '管理権限がありません。';
  END IF;

  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '開催枠が見つかりません。';
  END IF;

  SELECT count(*) INTO v_reserved_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';

  SELECT count(*) INTO v_walkin_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  SELECT count(*) INTO v_pre_reserved_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';

  SELECT count(*) INTO v_pre_walkin_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  -- Checking constraints based on ticket type
  IF p_ticket_type = 'reservation' THEN
    IF (v_reserved_count + v_pre_reserved_count) >= COALESCE(v_slot.reservation_capacity, v_slot.total_capacity) THEN
      RAISE EXCEPTION '予約枠の定員に達しました。';
    END IF;
  ELSE
    IF (v_walkin_count + v_pre_walkin_count) >= COALESCE(v_slot.walkin_limit, v_slot.total_capacity) THEN
      RAISE EXCEPTION '当日券の発行上限に達しました。';
    END IF;
  END IF;

  -- Total capacity check
  IF (v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO admin_pre_registrations (
    event_id,
    event_slot_id,
    student_name,
    student_number,
    university_email,
    ticket_type,
    status
  ) VALUES (
    p_event_id,
    p_event_slot_id,
    p_student_name,
    p_student_number,
    p_university_email,
    p_ticket_type,
    'reserved'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
