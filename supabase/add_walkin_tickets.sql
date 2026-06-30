-- ====================================================================
-- WALK-IN TICKETS MIGRATION SCRIPT (WITH SLOT-LEVEL WINDOWS)
-- Run this in the Supabase SQL Editor to update the schema and RPCs.
-- ====================================================================

-- ==========================================
-- 1. DROP EXISTING FUNCTIONS TO AVOID RETURN TYPE CONFLICTS
-- ==========================================
DROP FUNCTION IF EXISTS create_reservation(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS create_reservation(uuid, text, text, text);
DROP FUNCTION IF EXISTS create_reservations_bulk(uuid, uuid[], text, text, text);
DROP FUNCTION IF EXISTS create_walkin_reservation(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS get_event_slots(uuid);
DROP FUNCTION IF EXISTS get_public_events();
DROP FUNCTION IF EXISTS get_ticket(text);
DROP FUNCTION IF EXISTS find_ticket(uuid, text, text, text);
DROP FUNCTION IF EXISTS use_ticket(text);
DROP FUNCTION IF EXISTS delete_event_admin(uuid);

-- ==========================================
-- 2. ALTER TABLES AND MIGRATE DATA
-- ==========================================

-- Add ticket_type to reservations table
ALTER TABLE reservations 
  ADD COLUMN IF NOT EXISTS ticket_type text NOT NULL DEFAULT 'reservation' 
  CONSTRAINT check_ticket_type CHECK (ticket_type IN ('reservation', 'walkin'));

-- Add capacity and slot-level window columns
DO $$ BEGIN
  -- 1. Add total_capacity if not exists
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_slots' AND column_name = 'total_capacity') THEN
    ALTER TABLE event_slots ADD COLUMN total_capacity integer NOT NULL DEFAULT 0;
    -- Copy old capacity to total_capacity
    UPDATE event_slots SET total_capacity = capacity;
  END IF;

  -- 2. Rename capacity to reservation_capacity if capacity exists
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_slots' AND column_name = 'capacity') THEN
    ALTER TABLE event_slots RENAME COLUMN capacity TO reservation_capacity;
  END IF;

  -- 3. Add CHECK constraint
  IF NOT EXISTS (SELECT 1 FROM information_schema.constraint_column_usage WHERE table_name = 'event_slots' AND constraint_name = 'check_capacities') THEN
    ALTER TABLE event_slots ADD CONSTRAINT check_capacities CHECK (total_capacity >= 0 AND reservation_capacity >= 0 AND reservation_capacity <= total_capacity);
  END IF;

  -- 4. Add slot-level window columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_slots' AND column_name = 'reservation_use_starts_at') THEN
    ALTER TABLE event_slots ADD COLUMN reservation_use_starts_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_slots' AND column_name = 'reservation_use_ends_at') THEN
    ALTER TABLE event_slots ADD COLUMN reservation_use_ends_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_slots' AND column_name = 'walkin_use_starts_at') THEN
    ALTER TABLE event_slots ADD COLUMN walkin_use_starts_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'event_slots' AND column_name = 'walkin_use_ends_at') THEN
    ALTER TABLE event_slots ADD COLUMN walkin_use_ends_at timestamptz;
  END IF;
END $$;

-- Migrate default window values to event_slots from events table
UPDATE event_slots es
SET 
  reservation_use_starts_at = COALESCE(es.reservation_use_starts_at, e.use_starts_at, es.starts_at),
  reservation_use_ends_at = COALESCE(es.reservation_use_ends_at, e.use_ends_at, es.ends_at),
  walkin_use_starts_at = COALESCE(es.walkin_use_starts_at, e.use_starts_at, es.starts_at),
  walkin_use_ends_at = COALESCE(es.walkin_use_ends_at, e.use_ends_at, es.ends_at)
FROM events e
WHERE es.event_id = e.id
  AND (es.reservation_use_starts_at IS NULL OR es.reservation_use_ends_at IS NULL OR es.walkin_use_starts_at IS NULL OR es.walkin_use_ends_at IS NULL);


-- ==========================================
-- 3. DEFINE NEW & MODIFIED RPC FUNCTIONS
-- ==========================================

-- 3-1. create_reservation (Updated for reservation_capacity and mutual exclusion)
CREATE OR REPLACE FUNCTION create_reservation(
  p_event_id uuid,
  p_event_slot_id uuid,
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
  v_active_reserved_count bigint;
BEGIN
  -- Normalize inputs
  v_normalized_student_number := upper(trim(p_student_number));
  IF v_normalized_student_number LIKE 'S%' THEN
    v_normalized_student_number := substring(v_normalized_student_number from 2);
  END IF;
  v_normalized_email := lower(trim(p_university_email));

  -- Validate empty values
  IF p_student_name IS NULL OR trim(p_student_name) = '' THEN
    RAISE EXCEPTION '氏名を入力してください。';
  END IF;
  IF v_normalized_student_number = '' THEN
    RAISE EXCEPTION '学籍番号を入力してください。';
  END IF;
  IF v_normalized_email = '' THEN
    RAISE EXCEPTION 'メールアドレスを入力してください。';
  END IF;

  -- Validate student number format
  IF NOT (v_normalized_student_number ~ '^\d{2}[A-Z]\d{3}$') THEN
    RAISE EXCEPTION '学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)';
  END IF;

  -- Verify email matches student number
  IF split_part(v_normalized_email, '@', 1) != 's' || lower(v_normalized_student_number) THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しません。';
  END IF;

  -- Lock event row
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
  END IF;
  IF NOT v_event.reservation_enabled THEN
    RAISE EXCEPTION 'この企画の予約受付は停止されています。';
  END IF;
  IF v_event.reservation_starts_at IS NOT NULL AND now() < v_event.reservation_starts_at THEN
    RAISE EXCEPTION '予約受付期間外です（開始前）。';
  END IF;
  IF v_event.reservation_ends_at IS NOT NULL AND now() > v_event.reservation_ends_at THEN
    RAISE EXCEPTION '予約受付期間外です（終了）。';
  END IF;

  -- Validate email domain
  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  -- Lock slot row and validate
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'この開催枠は現在受付停止中です。';
  END IF;

  -- Mutual exclusion: Check if student already holds a walk-in ticket for this slot
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status != 'cancelled'
      AND ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION '当日券取得済み：この開催枠はすでに当日券を取得しているため、予約券は取得できません。';
  END IF;

  -- Check slot reservation capacity
  SELECT count(*) INTO v_active_reserved_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id 
    AND status != 'cancelled' 
    AND ticket_type = 'reservation';

  IF v_active_reserved_count >= v_slot.reservation_capacity THEN
    RAISE EXCEPTION 'この開催枠の予約券は定員に達しています。';
  END IF;

  -- Check duplicate reservations based on slot_selection_mode (only check reservation tickets)
  IF v_event.slot_selection_mode = 'single' THEN
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND (r.student_number = v_normalized_student_number OR r.university_email = v_normalized_email)
        AND r.status != 'cancelled'
        AND r.ticket_type = 'reservation'
    ) THEN
      RAISE EXCEPTION 'この学籍番号またはメールアドレスは既にこの企画を予約しています。';
    END IF;
  ELSE
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = p_event_slot_id
        AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
        AND status != 'cancelled'
        AND ticket_type = 'reservation'
    ) THEN
      RAISE EXCEPTION 'この学籍番号またはメールアドレスは既にこの開催枠を予約しています。';
    END IF;
  END IF;

  -- Generate tokens
  v_public_token := gen_random_uuid()::text;
  LOOP
    v_ticket_code := upper(substring(md5(random()::text) from 1 for 8));
    IF NOT EXISTS (SELECT 1 FROM reservations WHERE ticket_code = v_ticket_code) THEN
      EXIT;
    END IF;
  END LOOP;

  -- Insert reservation
  INSERT INTO reservations (
    event_id, event_slot_id, student_name, student_number,
    university_email, ticket_code, public_token, status, ticket_type
  ) VALUES (
    p_event_id, p_event_slot_id, trim(p_student_name), v_normalized_student_number,
    v_normalized_email, v_ticket_code, v_public_token, 'reserved', 'reservation'
  ) RETURNING * INTO v_new_reservation;

  RETURN json_build_object(
    'id', v_new_reservation.id,
    'event_id', v_new_reservation.event_id,
    'event_slot_id', v_new_reservation.event_slot_id,
    'student_name', v_new_reservation.student_name,
    'student_number', v_new_reservation.student_number,
    'ticket_code', v_new_reservation.ticket_code,
    'public_token', v_new_reservation.public_token,
    'status', v_new_reservation.status,
    'ticket_type', v_new_reservation.ticket_type,
    'created_at', v_new_reservation.created_at
  );
END;
$$;


-- 3-2. create_reservations_bulk (Updated for reservation_capacity and mutual exclusion)
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
BEGIN
  -- Validate array input
  IF p_event_slot_ids IS NULL OR array_length(p_event_slot_ids, 1) IS NULL OR array_length(p_event_slot_ids, 1) = 0 THEN
    RAISE EXCEPTION '開催枠を1つ以上選択してください。';
  END IF;

  -- Check for duplicate slot IDs
  SELECT array_agg(DISTINCT s) INTO v_unique_slot_ids FROM unnest(p_event_slot_ids) s;
  IF array_length(v_unique_slot_ids, 1) != array_length(p_event_slot_ids, 1) THEN
    RAISE EXCEPTION '同じ開催枠が重複して選択されています。';
  END IF;

  -- Normalize inputs
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

  -- Lock event row
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
  END IF;
  IF NOT v_event.reservation_enabled THEN
    RAISE EXCEPTION 'この企画の予約受付は停止されています。';
  END IF;
  IF v_event.reservation_starts_at IS NOT NULL AND now() < v_event.reservation_starts_at THEN
    RAISE EXCEPTION '予約受付期間外です（開始前）。';
  END IF;
  IF v_event.reservation_ends_at IS NOT NULL AND now() > v_event.reservation_ends_at THEN
    RAISE EXCEPTION '予約受付期間外です（終了）。';
  END IF;

  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  -- Enforce single mode constraint
  IF v_event.slot_selection_mode = 'single' THEN
    IF array_length(p_event_slot_ids, 1) > 1 THEN
      RAISE EXCEPTION 'この企画は1枠のみ予約可能です。';
    END IF;
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND (r.student_number = v_normalized_student_number OR r.university_email = v_normalized_email)
        AND r.status != 'cancelled'
        AND r.ticket_type = 'reservation'
    ) THEN
      RAISE EXCEPTION 'この学籍番号またはメールアドレスは既にこの企画を予約しています。';
    END IF;
  END IF;

  -- Lock all requested slot rows (ordered to prevent deadlocks)
  FOR v_slot IN
    SELECT * FROM event_slots
    WHERE id = ANY(p_event_slot_ids) AND event_id = p_event_id
    ORDER BY id
    FOR UPDATE
  LOOP
    -- rows locked
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

    -- Mutual exclusion: Check if student already holds a walk-in ticket for this slot
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = v_slot_id
        AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
        AND status != 'cancelled'
        AND ticket_type = 'walkin'
    ) THEN
      RAISE EXCEPTION '当日券取得済み：開催枠「%」はすでに当日券を取得しているため、予約券は取得できません。', v_slot.label;
    END IF;

    -- Check reservation capacity
    SELECT count(*) INTO v_active_reserved_count 
    FROM reservations 
    WHERE event_slot_id = v_slot_id 
      AND status != 'cancelled' 
      AND ticket_type = 'reservation';

    IF v_active_reserved_count >= v_slot.reservation_capacity THEN
      RAISE EXCEPTION '開催枠「%」は予約券が定員に達しています。', v_slot.label;
    END IF;

    IF v_event.slot_selection_mode = 'multiple' THEN
      IF EXISTS (
        SELECT 1 FROM reservations
        WHERE event_slot_id = v_slot_id
          AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
          AND status != 'cancelled'
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

  RETURN array_to_json(v_results);
END;
$$;


-- 3-3. create_walkin_reservation (NEW: walk-in specific reservation RPC with slot-level window check)
CREATE OR REPLACE FUNCTION create_walkin_reservation(
  p_event_id uuid,
  p_event_slot_id uuid,
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
  v_reserved_count bigint;
  v_walkin_count bigint;
  v_walkin_starts timestamptz;
  v_walkin_ends timestamptz;
BEGIN
  -- Normalize inputs
  v_normalized_student_number := upper(trim(p_student_number));
  IF v_normalized_student_number LIKE 'S%' THEN
    v_normalized_student_number := substring(v_normalized_student_number from 2);
  END IF;
  v_normalized_email := lower(trim(p_university_email));

  -- Validate empty values
  IF p_student_name IS NULL OR trim(p_student_name) = '' THEN
    RAISE EXCEPTION '氏名を入力してください。';
  END IF;
  IF v_normalized_student_number = '' THEN
    RAISE EXCEPTION '学籍番号を入力してください。';
  END IF;
  IF v_normalized_email = '' THEN
    RAISE EXCEPTION 'メールアドレスを入力してください。';
  END IF;

  -- Validate student number format
  IF NOT (v_normalized_student_number ~ '^\d{2}[A-Z]\d{3}$') THEN
    RAISE EXCEPTION '学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)';
  END IF;

  -- Verify email matches student number
  IF split_part(v_normalized_email, '@', 1) != 's' || lower(v_normalized_student_number) THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しません。';
  END IF;

  -- Lock event row
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
  END IF;
  IF NOT v_event.reservation_enabled THEN
    RAISE EXCEPTION 'この企画の予約受付は停止されています。';
  END IF;
  
  -- Lock slot row and validate
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'この開催枠は現在受付停止中です。';
  END IF;

  -- Validate walk-in ticket availability window (slot-level only, no fallback)
  v_walkin_starts := v_slot.walkin_use_starts_at;
  v_walkin_ends := v_slot.walkin_use_ends_at;

  IF v_walkin_starts IS NOT NULL AND now() < v_walkin_starts THEN
    RAISE EXCEPTION '当日券はまだ取得できません。受付開始は % です。', to_char(v_walkin_starts AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI');
  END IF;
  IF v_walkin_ends IS NOT NULL AND now() > v_walkin_ends THEN
    RAISE EXCEPTION '当日券の受付は終了しました。';
  END IF;

  -- Validate email domain
  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  -- 1. Check duplicate: Is already reserved with ticket_type = 'reservation' (予約済み)
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status != 'cancelled'
      AND ticket_type = 'reservation'
  ) THEN
    RAISE EXCEPTION '予約済み：この日はすでに予約券を取得しているため、当日券は取得できません。';
  END IF;

  -- 2. Check duplicate: Is already walk-in registered (取得済み)
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status != 'cancelled'
      AND ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION '取得済み：この日の当日券はすでに取得済みです。';
  END IF;

  -- Calculate active counts
  SELECT count(*) INTO v_reserved_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'reservation';
  
  SELECT count(*) INTO v_walkin_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status != 'cancelled' AND ticket_type = 'walkin';

  -- 3. Check total capacity limit (定員到達)
  IF (v_reserved_count + v_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '定員到達：当日券は定員に達しました。';
  END IF;

  -- Generate tokens
  v_public_token := gen_random_uuid()::text;
  LOOP
    v_ticket_code := upper(substring(md5(random()::text) from 1 for 8));
    IF NOT EXISTS (SELECT 1 FROM reservations WHERE ticket_code = v_ticket_code) THEN
      EXIT;
    END IF;
  END LOOP;

  -- Insert reservation
  INSERT INTO reservations (
    event_id, event_slot_id, student_name, student_number,
    university_email, ticket_code, public_token, status, ticket_type
  ) VALUES (
    p_event_id, p_event_slot_id, trim(p_student_name), v_normalized_student_number,
    v_normalized_email, v_ticket_code, v_public_token, 'reserved', 'walkin'
  ) RETURNING * INTO v_new_reservation;

  RETURN json_build_object(
    'id', v_new_reservation.id,
    'event_id', v_new_reservation.event_id,
    'event_slot_id', v_new_reservation.event_slot_id,
    'student_name', v_new_reservation.student_name,
    'student_number', v_new_reservation.student_number,
    'ticket_code', v_new_reservation.ticket_code,
    'public_token', v_new_reservation.public_token,
    'status', v_new_reservation.status,
    'ticket_type', v_new_reservation.ticket_type,
    'created_at', v_new_reservation.created_at
  );
END;
$$;


-- 3-4. get_event_slots (Updated to return dynamic capacity counts and new slot-level windows)
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
  reservation_use_starts_at timestamptz,
  reservation_use_ends_at timestamptz,
  walkin_use_starts_at timestamptz,
  walkin_use_ends_at timestamptz,
  -- Backwards compatibility aliases
  capacity integer,
  remaining_slots bigint
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
    COALESCE(res.res_count, 0)::bigint AS reserved_count,
    COALESCE(res.walk_count, 0)::bigint AS walkin_count,
    GREATEST(es.reservation_capacity - COALESCE(res.res_count, 0), 0)::bigint AS remaining_reservation_slots,
    GREATEST(es.total_capacity - COALESCE(res.res_count, 0) - COALESCE(res.walk_count, 0), 0)::bigint AS remaining_walkin_slots,
    es.reservation_use_starts_at,
    es.reservation_use_ends_at,
    es.walkin_use_starts_at,
    es.walkin_use_ends_at,
    -- Backwards compatibility: capacity returns reservation_capacity, remaining_slots returns remaining_reservation_slots
    es.reservation_capacity AS capacity,
    GREATEST(es.reservation_capacity - COALESCE(res.res_count, 0), 0)::bigint AS remaining_slots
  FROM event_slots es
  LEFT JOIN (
    SELECT 
      event_slot_id,
      count(*) FILTER (WHERE status != 'cancelled' AND ticket_type = 'reservation') AS res_count,
      count(*) FILTER (WHERE status != 'cancelled' AND ticket_type = 'walkin') AS walk_count
    FROM reservations
    GROUP BY event_slot_id
  ) res ON es.id = res.event_slot_id
  WHERE es.event_id = p_event_id
  ORDER BY es.sort_order, es.starts_at, es.created_at;
END;
$$;


-- 3-5. get_public_events (Updated to aggregate dynamic capacity counts and walkin availability)
CREATE OR REPLACE FUNCTION get_public_events()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  capacity integer, -- Compatibility (uses sum of reservation_capacity)
  starts_at timestamptz,
  ends_at timestamptz,
  reservation_starts_at timestamptz,
  reservation_ends_at timestamptz,
  reservation_enabled boolean,
  ticket_enabled boolean,
  use_button_enabled boolean,
  use_starts_at timestamptz,
  use_ends_at timestamptz,
  allowed_email_domains text[],
  slot_selection_mode text,
  survey_after_reservation_enabled boolean,
  survey_after_reservation_url text,
  survey_after_reservation_message text,
  survey_after_use_enabled boolean,
  survey_after_use_url text,
  survey_after_use_message text,
  created_at timestamptz,
  remaining_slots bigint, -- Compatibility (uses sum of remaining_reservation_slots)
  total_capacity integer,
  reservation_capacity integer,
  reserved_count bigint,
  walkin_count bigint,
  remaining_reservation_slots bigint,
  remaining_walkin_slots bigint,
  has_walkin_active boolean,
  has_walkin_upcoming boolean,
  slots jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.title,
    e.description,
    COALESCE(slot_stats.sum_res_cap, e.capacity)::integer AS capacity,
    e.starts_at,
    e.ends_at,
    e.reservation_starts_at,
    e.reservation_ends_at,
    e.reservation_enabled,
    e.ticket_enabled,
    e.use_button_enabled,
    e.use_starts_at,
    e.use_ends_at,
    e.allowed_email_domains,
    e.slot_selection_mode,
    e.survey_after_reservation_enabled,
    e.survey_after_reservation_url,
    e.survey_after_reservation_message,
    e.survey_after_use_enabled,
    e.survey_after_use_url,
    e.survey_after_use_message,
    e.created_at,
    COALESCE(slot_stats.sum_rem_res, 0)::bigint AS remaining_slots,
    COALESCE(slot_stats.sum_total_cap, 0)::integer AS total_capacity,
    COALESCE(slot_stats.sum_res_cap, 0)::integer AS reservation_capacity,
    COALESCE(slot_stats.sum_res_count, 0)::bigint AS reserved_count,
    COALESCE(slot_stats.sum_walk_count, 0)::bigint AS walkin_count,
    COALESCE(slot_stats.sum_rem_res, 0)::bigint AS remaining_reservation_slots,
    COALESCE(slot_stats.sum_rem_walk, 0)::bigint AS remaining_walkin_slots,
    COALESCE(slot_stats.has_walkin_active, false) AS has_walkin_active,
    COALESCE(slot_stats.has_walkin_upcoming, false) AS has_walkin_upcoming,
    COALESCE(slot_stats.slots_json, '[]'::jsonb) AS slots
  FROM events e
  LEFT JOIN (
    SELECT
      es.event_id,
      SUM(es.total_capacity) AS sum_total_cap,
      SUM(es.reservation_capacity) AS sum_res_cap,
      SUM(COALESCE(r_counts.res_count, 0)) AS sum_res_count,
      SUM(COALESCE(r_counts.walk_count, 0)) AS sum_walk_count,
      SUM(GREATEST(es.reservation_capacity - COALESCE(r_counts.res_count, 0), 0)) AS sum_rem_res,
      SUM(GREATEST(es.total_capacity - COALESCE(r_counts.res_count, 0) - COALESCE(r_counts.walk_count, 0), 0)) AS sum_rem_walk,
      COALESCE(bool_or(es.is_enabled = true AND (es.walkin_use_starts_at IS NULL OR now() >= es.walkin_use_starts_at) AND (es.walkin_use_ends_at IS NULL OR now() <= es.walkin_use_ends_at)), false) AS has_walkin_active,
      COALESCE(bool_or(es.is_enabled = true AND es.walkin_use_starts_at IS NOT NULL AND now() < es.walkin_use_starts_at), false) AS has_walkin_upcoming,
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'label', es.label,
          'starts_at', es.starts_at,
          'ends_at', es.ends_at,
          'is_enabled', es.is_enabled,
          'total_capacity', es.total_capacity,
          'reservation_capacity', es.reservation_capacity,
          'remaining_reservation_slots', GREATEST(es.reservation_capacity - COALESCE(r_counts.res_count, 0), 0),
          'remaining_walkin_slots', GREATEST(es.total_capacity - COALESCE(r_counts.res_count, 0) - COALESCE(r_counts.walk_count, 0), 0),
          'reservation_use_starts_at', es.reservation_use_starts_at,
          'reservation_use_ends_at', es.reservation_use_ends_at,
          'walkin_use_starts_at', es.walkin_use_starts_at,
          'walkin_use_ends_at', es.walkin_use_ends_at
        ) ORDER BY es.sort_order, es.starts_at, es.created_at
      ) AS slots_json
    FROM event_slots es
    LEFT JOIN (
      SELECT 
        event_slot_id,
        count(*) FILTER (WHERE status != 'cancelled' AND ticket_type = 'reservation') AS res_count,
        count(*) FILTER (WHERE status != 'cancelled' AND ticket_type = 'walkin') AS walk_count
      FROM reservations
      GROUP BY event_slot_id
    ) r_counts ON es.id = r_counts.event_slot_id
    WHERE es.is_enabled = true
    GROUP BY es.event_id
  ) slot_stats ON e.id = slot_stats.event_id
  WHERE e.is_public = true
  ORDER BY e.created_at DESC;
END;
$$;


-- 3-6. get_ticket (Updated to return new slot-level windows)
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
  slot_id uuid,
  slot_label text,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz,
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
    es.id AS slot_id,
    es.label AS slot_label,
    es.starts_at AS slot_starts_at,
    es.ends_at AS slot_ends_at,
    es.reservation_use_starts_at,
    es.reservation_use_ends_at,
    es.walkin_use_starts_at,
    es.walkin_use_ends_at
  FROM reservations r
  JOIN events e ON r.event_id = e.id
  LEFT JOIN event_slots es ON r.event_slot_id = es.id
  WHERE r.public_token = p_public_token;
END;
$$;


-- 3-7. find_ticket (Refreshed, returns token regardless of ticket_type)
CREATE OR REPLACE FUNCTION find_ticket(
  p_event_id uuid,
  p_student_name text,
  p_student_number text,
  p_university_email text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_public_token text;
  v_normalized_student_number text;
  v_normalized_email text;
BEGIN
  v_normalized_student_number := upper(trim(p_student_number));
  IF v_normalized_student_number LIKE 'S%' THEN
    v_normalized_student_number := substring(v_normalized_student_number from 2);
  END IF;
  v_normalized_email := lower(trim(p_university_email));

  SELECT public_token INTO v_public_token
  FROM reservations
  WHERE event_id = p_event_id
    AND student_name = trim(p_student_name)
    AND student_number = v_normalized_student_number
    AND university_email = v_normalized_email
    AND status != 'cancelled'
  LIMIT 1;

  RETURN v_public_token;
END;
$$;


-- 3-8. use_ticket (Updated to check slot-level availability window per ticket type)
CREATE OR REPLACE FUNCTION use_ticket(
  p_public_token text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reservation record;
  v_use_starts_at timestamptz;
  v_use_ends_at timestamptz;
BEGIN
  SELECT 
    r.*, 
    e.use_starts_at AS event_use_starts_at, 
    e.use_ends_at AS event_use_ends_at, 
    e.ticket_enabled, 
    e.use_button_enabled,
    es.reservation_use_starts_at,
    es.reservation_use_ends_at,
    es.walkin_use_starts_at,
    es.walkin_use_ends_at
  INTO v_reservation
  FROM reservations r
  JOIN events e ON r.event_id = e.id
  LEFT JOIN event_slots es ON r.event_slot_id = es.id
  WHERE r.public_token = p_public_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットが見つかりません。';
  END IF;

  IF v_reservation.status = 'cancelled' THEN
    RAISE EXCEPTION 'このチケットはキャンセルされています。';
  END IF;

  IF v_reservation.status = 'used' THEN
    RETURN json_build_object(
      'status', 'used',
      'used_at', v_reservation.used_at
    );
  END IF;

  IF NOT v_reservation.ticket_enabled OR NOT v_reservation.use_button_enabled THEN
    RAISE EXCEPTION 'このイベントではチケットの使用ボタンが有効化されていません。';
  END IF;

  -- Determine use windows based on ticket type (slot-level only, no event-level fallback)
  IF v_reservation.ticket_type = 'walkin' THEN
    v_use_starts_at := v_reservation.walkin_use_starts_at;
    v_use_ends_at := v_reservation.walkin_use_ends_at;
  ELSE
    v_use_starts_at := v_reservation.reservation_use_starts_at;
    v_use_ends_at := v_reservation.reservation_use_ends_at;
  END IF;

  IF v_use_starts_at IS NOT NULL AND now() < v_use_starts_at THEN
    RAISE EXCEPTION 'チケット使用可能時間前です。使用開始は % からです。', to_char(v_use_starts_at AT TIME ZONE 'Asia/Tokyo', 'MM/DD HH24:MI');
  END IF;
  IF v_use_ends_at IS NOT NULL AND now() > v_use_ends_at THEN
    RAISE EXCEPTION 'チケット使用可能時間を過ぎています。';
  END IF;

  UPDATE reservations
  SET status = 'used', used_at = now()
  WHERE public_token = p_public_token
  RETURNING * INTO v_reservation;

  RETURN json_build_object(
    'status', v_reservation.status,
    'used_at', v_reservation.used_at
  );
END;
$$;


-- ==========================================
-- 3-8. delete_event_admin (Administrative event deletion)
-- ==========================================
CREATE OR REPLACE FUNCTION delete_event_admin(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
BEGIN
  -- Check if user is authenticated and is an admin
  SELECT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = auth.uid()
  ) INTO v_is_admin;

  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION '管理者権限がありません。';
  END IF;

  -- 1. Delete reservations associated with the slots of the event
  DELETE FROM reservations
  WHERE event_slot_id IN (
    SELECT id FROM event_slots WHERE event_id = p_event_id
  );

  -- 2. Delete the event_slots
  DELETE FROM event_slots
  WHERE event_id = p_event_id;

  -- 3. Delete the event itself
  DELETE FROM events
  WHERE id = p_event_id;
END;
$$;

