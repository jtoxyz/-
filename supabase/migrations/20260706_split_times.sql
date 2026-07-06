-- ====================================================================
-- TRANSACTIONAL MIGRATION SCRIPT: SLOT-LEVEL TIME & CAPACITY SPLIT (REVISED v2)
-- ====================================================================

BEGIN;

-- ==========================================
-- 1. ADD NEW COLUMNS TO EVENT_SLOTS TABLE
-- ==========================================
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS reservation_starts_at timestamptz;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS reservation_ends_at timestamptz;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS ticket_use_starts_at timestamptz;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS ticket_use_ends_at timestamptz;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS walkin_starts_at timestamptz;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS walkin_ends_at timestamptz;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS is_reservation_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS is_ticket_use_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS is_walkin_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE event_slots ADD COLUMN IF NOT EXISTS walkin_limit integer DEFAULT NULL;

-- ==========================================
-- 2. ADD CONSTRAINTS TO EVENT_SLOTS TABLE
-- ==========================================
ALTER TABLE event_slots DROP CONSTRAINT IF EXISTS chk_event_slots_walkin_limit;
ALTER TABLE event_slots DROP CONSTRAINT IF EXISTS chk_event_slots_reservation_dates;
ALTER TABLE event_slots DROP CONSTRAINT IF EXISTS chk_event_slots_ticket_use_dates;
ALTER TABLE event_slots DROP CONSTRAINT IF EXISTS chk_event_slots_walkin_dates;

ALTER TABLE event_slots ADD CONSTRAINT chk_event_slots_walkin_limit CHECK (walkin_limit IS NULL OR walkin_limit >= 0);
ALTER TABLE event_slots ADD CONSTRAINT chk_event_slots_reservation_dates CHECK (reservation_starts_at IS NULL OR reservation_ends_at IS NULL OR reservation_starts_at <= reservation_ends_at);
ALTER TABLE event_slots ADD CONSTRAINT chk_event_slots_ticket_use_dates CHECK (ticket_use_starts_at IS NULL OR ticket_use_ends_at IS NULL OR ticket_use_starts_at <= ticket_use_ends_at);
ALTER TABLE event_slots ADD CONSTRAINT chk_event_slots_walkin_dates CHECK (walkin_starts_at IS NULL OR walkin_ends_at IS NULL OR walkin_starts_at <= walkin_ends_at);

-- ==========================================
-- 3. MIGRATE DATA FROM OLD COLUMNS
-- ==========================================
UPDATE event_slots es
SET 
  reservation_starts_at = COALESCE(es.reservation_starts_at, e.reservation_starts_at),
  reservation_ends_at = COALESCE(es.reservation_ends_at, e.reservation_ends_at),
  ticket_use_starts_at = COALESCE(es.ticket_use_starts_at, es.reservation_use_starts_at, e.use_starts_at, es.starts_at),
  ticket_use_ends_at = COALESCE(es.ticket_use_ends_at, es.reservation_use_ends_at, e.use_ends_at, es.ends_at),
  walkin_starts_at = COALESCE(es.walkin_starts_at, es.walkin_use_starts_at, e.use_starts_at, es.starts_at),
  walkin_ends_at = COALESCE(es.walkin_ends_at, es.walkin_use_ends_at, e.use_ends_at, es.ends_at),
  is_reservation_enabled = COALESCE(es.is_enabled, true),
  is_ticket_use_enabled = COALESCE(e.use_button_enabled, true),
  is_walkin_enabled = COALESCE(es.is_enabled, true)
FROM events e
WHERE es.event_id = e.id;

-- ==========================================
-- 4. DROP EXISTING FUNCTIONS
-- ==========================================
DROP FUNCTION IF EXISTS create_reservation(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS create_reservations_bulk(uuid, uuid[], text, text, text);
DROP FUNCTION IF EXISTS create_walkin_reservation(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS get_event_slots(uuid);
DROP FUNCTION IF EXISTS get_public_events();
DROP FUNCTION IF EXISTS get_ticket(text);
DROP FUNCTION IF EXISTS use_ticket(text);

-- ==========================================
-- 5. RECREATE RPC FUNCTIONS
-- ==========================================

-- 5-1. create_reservation (Advance Booking)
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
  v_active_walkin_count bigint;
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

  -- Prevent concurrent duplicate bookings for a single student on the same event
  -- Using a transaction-level advisory lock scoped to (event_id, student_number)
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_event_id::text || ':' || v_normalized_student_number,
      0
    )
  );

  -- Read event row (without FOR UPDATE to avoid blocking other slots of the same event)
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
  END IF;

  -- Lock slot row and validate
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'この開催枠は現在受付停止中です。';
  END IF;

  -- Timing validation
  IF NOT v_slot.is_reservation_enabled THEN
    RAISE EXCEPTION '通常予約の受付期間外です';
  END IF;
  IF v_slot.reservation_starts_at IS NOT NULL AND now() < v_slot.reservation_starts_at THEN
    RAISE EXCEPTION '通常予約の受付期間外です';
  END IF;
  IF v_slot.reservation_ends_at IS NOT NULL AND now() > v_slot.reservation_ends_at THEN
    RAISE EXCEPTION '通常予約の受付期間外です';
  END IF;

  -- Validate email domain
  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  -- Mutual exclusion: Check if student already holds a walk-in ticket for this slot
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION '当日券取得済み：この開催枠はすでに当日券を取得しているため、予約券は取得できません。';
  END IF;

  -- Calculate active counts
  SELECT count(*) INTO v_active_reserved_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id 
    AND status IN ('reserved', 'used') 
    AND ticket_type = 'reservation';

  SELECT count(*) INTO v_active_walkin_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id
    AND status IN ('reserved', 'used')
    AND ticket_type = 'walkin';

  -- Check slot reservation capacity (respecting total capacity)
  IF v_active_reserved_count >= v_slot.reservation_capacity THEN
    RAISE EXCEPTION 'この開催枠の予約券は定員に達しています。';
  END IF;

  -- Check total capacity limit
  IF (v_active_reserved_count + v_active_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION 'この開催枠の予約券は定員に達しています。';
  END IF;

  -- Check duplicate reservations based on slot_selection_mode (only check reservation tickets)
  IF v_event.slot_selection_mode = 'single' THEN
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
  ELSE
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = p_event_slot_id
        AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
        AND status IN ('reserved', 'used')
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


-- 5-2. create_reservations_bulk (Bulk Advance Booking)
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

  -- Prevent concurrent duplicate bookings for a single student on the same event
  -- Using a transaction-level advisory lock scoped to (event_id, student_number)
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      p_event_id::text || ':' || v_normalized_student_number,
      0
    )
  );

  -- Read event row (without FOR UPDATE to avoid blocking other slots of the same event)
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
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
        AND r.status IN ('reserved', 'used')
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

    -- Timing validation
    IF NOT v_slot.is_reservation_enabled THEN
      RAISE EXCEPTION '開催枠「%」は通常予約の受付期間外です。', v_slot.label;
    END IF;
    IF v_slot.reservation_starts_at IS NOT NULL AND now() < v_slot.reservation_starts_at THEN
      RAISE EXCEPTION '開催枠「%」は通常予約の受付期間外です。', v_slot.label;
    END IF;
    IF v_slot.reservation_ends_at IS NOT NULL AND now() > v_slot.reservation_ends_at THEN
      RAISE EXCEPTION '開催枠「%」は通常予約の受付期間外です。', v_slot.label;
    END IF;

    -- Mutual exclusion: Check if student already holds a walk-in ticket for this slot
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = v_slot_id
        AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
        AND status IN ('reserved', 'used')
        AND ticket_type = 'walkin'
    ) THEN
      RAISE EXCEPTION '当日券取得済み：開催枠「%」はすでに当日券を取得しているため、予約券は取得できません。', v_slot.label;
    END IF;

    -- Check reservation capacity
    SELECT count(*) INTO v_active_reserved_count 
    FROM reservations 
    WHERE event_slot_id = v_slot_id 
      AND status IN ('reserved', 'used') 
      AND ticket_type = 'reservation';

    IF v_active_reserved_count >= v_slot.reservation_capacity THEN
      RAISE EXCEPTION '開催枠「%」は予約券が定員に達しています。', v_slot.label;
    END IF;

    -- Check total capacity limit
    SELECT count(*) INTO v_active_walkin_count
    FROM reservations
    WHERE event_slot_id = v_slot_id
      AND status IN ('reserved', 'used')
      AND ticket_type = 'walkin';

    IF (v_active_reserved_count + v_active_walkin_count) >= v_slot.total_capacity THEN
      RAISE EXCEPTION '開催枠「%」は予約券が定員に達しています。', v_slot.label;
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

  RETURN array_to_json(v_results);
END;
$$;


-- 5-3. create_walkin_reservation (Walk-in Same-day Booking)
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

  -- Read event row (without FOR UPDATE to avoid blocking other slots of the same event)
  SELECT * INTO v_event FROM events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  IF NOT v_event.is_public THEN
    RAISE EXCEPTION 'この企画は公開されていません。';
  END IF;
  
  -- Lock ONLY the target slot row
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'この開催枠は現在受付停止中です。';
  END IF;

  -- Validate walk-in ticket availability window
  v_walkin_starts := v_slot.walkin_starts_at;
  v_walkin_ends := v_slot.walkin_ends_at;

  IF NOT v_slot.is_walkin_enabled THEN
    RAISE EXCEPTION '当日券の発行期間外です';
  END IF;
  IF v_walkin_starts IS NOT NULL AND now() < v_walkin_starts THEN
    RAISE EXCEPTION '当日券の発行開始前です';
  END IF;
  IF v_walkin_ends IS NOT NULL AND now() > v_walkin_ends THEN
    RAISE EXCEPTION '当日券の発行は終了しました';
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
      AND status IN ('reserved', 'used')
      AND ticket_type = 'reservation'
  ) THEN
    RAISE EXCEPTION '予約済み：この日はすでに予約券を取得しているため、当日券は取得できません。';
  END IF;

  -- 2. Check duplicate: Is already walk-in registered (取得済み)
  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION '取得済み：この日の当日券はすでに取得済みです。';
  END IF;

  -- Calculate active capacity-consuming counts
  SELECT count(*) INTO v_reserved_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'reservation';
  
  SELECT count(*) INTO v_walkin_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'walkin';

  -- 3. Check total capacity limit (定員到達)
  IF (v_reserved_count + v_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '満席のため当日券を発行できません';
  END IF;

  -- 4. Check walkin limit if configured
  IF v_slot.walkin_limit IS NOT NULL AND v_walkin_count >= v_slot.walkin_limit THEN
    RAISE EXCEPTION '満席のため当日券を発行できません';
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


-- 5-4. get_event_slots (Public Slot Config and Breakdown)
-- NOTE: This RPC must remain accessible to the public ('anon') because the studentbooking 
-- page (src/app/events/[id]/page.tsx) uses it to list slots and display remaining capacities.
-- It returns configuration settings and aggregate statistics only, and does not leak student numbers or emails.
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
    COALESCE(res.res_count, 0)::bigint AS reserved_count,
    COALESCE(res.walk_count, 0)::bigint AS walkin_count,
    GREATEST(LEAST(es.reservation_capacity - COALESCE(res.res_count, 0), es.total_capacity - COALESCE(res.res_count, 0) - COALESCE(res.walk_count, 0)), 0)::bigint AS remaining_reservation_slots,
    GREATEST(LEAST(es.total_capacity - COALESCE(res.res_count, 0) - COALESCE(res.walk_count, 0), COALESCE(es.walkin_limit, es.total_capacity) - COALESCE(res.walk_count, 0)), 0)::bigint AS remaining_walkin_slots,
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
    GREATEST(LEAST(es.reservation_capacity - COALESCE(res.res_count, 0), es.total_capacity - COALESCE(res.res_count, 0) - COALESCE(res.walk_count, 0)), 0)::bigint AS remaining_slots,
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
  WHERE es.event_id = p_event_id
  ORDER BY es.sort_order, es.starts_at, es.created_at;
END;
$$;


-- 5-5. get_public_events (Public listings aggregator)
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
      SUM(GREATEST(LEAST(es.reservation_capacity - COALESCE(r_counts.res_count, 0), es.total_capacity - COALESCE(r_counts.res_count, 0) - COALESCE(r_counts.walk_count, 0)), 0)) AS sum_rem_res,
      SUM(GREATEST(LEAST(es.total_capacity - COALESCE(r_counts.res_count, 0) - COALESCE(r_counts.walk_count, 0), COALESCE(es.walkin_limit, es.total_capacity) - COALESCE(r_counts.walk_count, 0)), 0)) AS sum_rem_walk,
      COALESCE(bool_or(es.is_enabled = true AND es.is_walkin_enabled = true AND (es.walkin_starts_at IS NULL OR now() >= es.walkin_starts_at) AND (es.walkin_ends_at IS NULL OR now() <= es.walkin_ends_at)), false) AS has_walkin_active,
      COALESCE(bool_or(es.is_enabled = true AND es.is_walkin_enabled = true AND es.walkin_starts_at IS NOT NULL AND now() < es.walkin_starts_at), false) AS has_walkin_upcoming,
      jsonb_agg(
        jsonb_build_object(
          'id', es.id,
          'label', es.label,
          'starts_at', es.starts_at,
          'ends_at', es.ends_at,
          'is_enabled', es.is_enabled,
          'total_capacity', es.total_capacity,
          'reservation_capacity', es.reservation_capacity,
          'remaining_reservation_slots', GREATEST(LEAST(es.reservation_capacity - COALESCE(r_counts.res_count, 0), es.total_capacity - COALESCE(r_counts.res_count, 0) - COALESCE(r_counts.walk_count, 0)), 0),
          'remaining_walkin_slots', GREATEST(LEAST(es.total_capacity - COALESCE(r_counts.res_count, 0) - COALESCE(r_counts.walk_count, 0), COALESCE(es.walkin_limit, es.total_capacity) - COALESCE(r_counts.walk_count, 0)), 0),
          'reservation_starts_at', es.reservation_starts_at,
          'reservation_ends_at', es.reservation_ends_at,
          'ticket_use_starts_at', es.ticket_use_starts_at,
          'ticket_use_ends_at', es.ticket_use_ends_at,
          'walkin_starts_at', es.walkin_starts_at,
          'walkin_ends_at', es.walkin_ends_at,
          'is_reservation_enabled', es.is_reservation_enabled,
          'is_ticket_use_enabled', es.is_ticket_use_enabled,
          'is_walkin_enabled', es.is_walkin_enabled,
          'walkin_limit', es.walkin_limit,
          -- backwards compat:
          'reservation_use_starts_at', es.ticket_use_starts_at,
          'reservation_use_ends_at', es.ticket_use_ends_at,
          'walkin_use_starts_at', es.walkin_starts_at,
          'walkin_use_ends_at', es.walkin_ends_at
        ) ORDER BY es.sort_order, es.starts_at, es.created_at
      ) AS slots_json
    FROM event_slots es
    LEFT JOIN (
      SELECT 
        event_slot_id,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'reservation') AS res_count,
        count(*) FILTER (WHERE status IN ('reserved', 'used') AND ticket_type = 'walkin') AS walk_count
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


-- 5-6. get_ticket (Ticket screen loader)
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


-- 5-7. use_ticket (Consume reservation ticket / walkin ticket)
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
  v_ticket_enabled boolean;
  v_use_button_enabled boolean;
  v_ticket_use_starts_at timestamptz;
  v_ticket_use_ends_at timestamptz;
  v_is_ticket_use_enabled boolean;
BEGIN
  -- 1. Select and lock target reservation row FOR UPDATE to prevent concurrency issues
  SELECT * INTO v_reservation 
  FROM reservations 
  WHERE public_token = p_public_token 
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットが見つかりません。';
  END IF;

  -- Distinguish states
  IF v_reservation.status = 'cancelled' THEN
    RAISE EXCEPTION 'このチケットはキャンセルされています。';
  END IF;

  IF v_reservation.status = 'used' THEN
    RETURN json_build_object(
      'status', 'used',
      'used_at', v_reservation.used_at
    );
  END IF;

  -- 2. Fetch event and slot details without locking them (as we only want to validate timings)
  SELECT 
    e.ticket_enabled, 
    e.use_button_enabled,
    es.ticket_use_starts_at,
    es.ticket_use_ends_at,
    es.is_ticket_use_enabled
  INTO 
    v_ticket_enabled, 
    v_use_button_enabled,
    v_ticket_use_starts_at,
    v_ticket_use_ends_at,
    v_is_ticket_use_enabled
  FROM events e
  LEFT JOIN event_slots es ON es.id = v_reservation.event_slot_id
  WHERE e.id = v_reservation.event_id;

  -- Fail-closed checks for existence and active configuration
  IF v_ticket_enabled IS NULL OR (v_reservation.event_slot_id IS NOT NULL AND v_is_ticket_use_enabled IS NULL) THEN
    RAISE EXCEPTION '関連するイベントまたは開催枠の設定が見つかりません。';
  END IF;

  IF v_ticket_enabled IS DISTINCT FROM true OR v_use_button_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'このイベントではチケットの使用ボタンが有効化されていません。';
  END IF;

  IF v_is_ticket_use_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'このチケットは使用不可に設定されています。';
  END IF;

  -- Timing validation on slot level
  IF v_ticket_use_starts_at IS NOT NULL AND now() < v_ticket_use_starts_at THEN
    RAISE EXCEPTION 'このチケットはまだ使用できません';
  END IF;
  IF v_ticket_use_ends_at IS NOT NULL AND now() > v_ticket_use_ends_at THEN
    RAISE EXCEPTION 'このチケットの使用可能時間は終了しました';
  END IF;

  -- 3. Execute atomic update
  UPDATE reservations
  SET status = 'used', used_at = now()
  WHERE id = v_reservation.id AND status = 'reserved'
  RETURNING * INTO v_reservation;

  IF NOT FOUND THEN
    -- Status changed under the lock or in concurrency
    RAISE EXCEPTION 'チケットはすでに使用されています。';
  END IF;

  RETURN json_build_object(
    'status', v_reservation.status,
    'used_at', v_reservation.used_at
  );
END;
$$;

-- ==========================================
-- 6. EXPLICITLY REVOKE DEFAULT PUBLIC EXECUTE RIGHTS
-- ==========================================
REVOKE ALL ON FUNCTION create_reservation(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_reservations_bulk(uuid, uuid[], text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_walkin_reservation(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_event_slots(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_public_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_ticket(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION use_ticket(text) FROM PUBLIC;

-- ==========================================
-- 7. RESTORE EXPLICIT EXECUTE GRANTS TO SPECIFIC ROLES ONLY
-- ==========================================
GRANT EXECUTE ON FUNCTION create_reservation(uuid, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_reservations_bulk(uuid, uuid[], text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_walkin_reservation(uuid, uuid, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_event_slots(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_events() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_ticket(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION use_ticket(text) TO anon, authenticated;

COMMIT;
