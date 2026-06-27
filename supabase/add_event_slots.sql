-- ====================================================================
-- EVENT SLOTS MIGRATION SCRIPT
-- Run this in the Supabase SQL Editor on the production database.
-- This script is idempotent where possible.
-- ====================================================================

-- =====================
-- 1. event_slots table
-- =====================
CREATE TABLE IF NOT EXISTS event_slots (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    label         text NOT NULL,
    starts_at     timestamptz,
    ends_at       timestamptz,
    capacity      integer NOT NULL CHECK (capacity > 0),
    is_enabled    boolean NOT NULL DEFAULT true,
    sort_order    integer NOT NULL DEFAULT 0,
    created_at    timestamptz DEFAULT now()
);

-- =====================
-- 2. event_slots RLS
-- =====================
ALTER TABLE event_slots ENABLE ROW LEVEL SECURITY;

-- Public can read slots of public events
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'event_slots_public_read' AND tablename = 'event_slots') THEN
    CREATE POLICY event_slots_public_read ON event_slots
      FOR SELECT USING (
        EXISTS (SELECT 1 FROM events WHERE events.id = event_slots.event_id AND events.is_public = true)
      );
  END IF;
END $$;

-- Admin full access
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'event_slots_admin_all' AND tablename = 'event_slots') THEN
    CREATE POLICY event_slots_admin_all ON event_slots
      FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
      );
  END IF;
END $$;

-- =====================
-- 3. events: add slot_selection_mode
-- =====================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'slot_selection_mode') THEN
    ALTER TABLE events ADD COLUMN slot_selection_mode text NOT NULL DEFAULT 'single';
    ALTER TABLE events ADD CONSTRAINT check_slot_selection_mode CHECK (slot_selection_mode IN ('single', 'multiple'));
  END IF;
END $$;

-- =====================
-- 4. reservations: add event_slot_id (nullable first)
-- =====================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'reservations' AND column_name = 'event_slot_id') THEN
    ALTER TABLE reservations ADD COLUMN event_slot_id uuid REFERENCES event_slots(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- =====================
-- 5. Data migration: create default slots for existing events
-- =====================
INSERT INTO event_slots (event_id, label, starts_at, ends_at, capacity, is_enabled, sort_order)
SELECT
  e.id,
  e.title,
  e.starts_at,
  e.ends_at,
  e.capacity,
  e.reservation_enabled,
  0
FROM events e
WHERE NOT EXISTS (
  SELECT 1 FROM event_slots es WHERE es.event_id = e.id
);

-- Link existing reservations to their default slot
UPDATE reservations r
SET event_slot_id = (
  SELECT es.id FROM event_slots es WHERE es.event_id = r.event_id ORDER BY es.sort_order LIMIT 1
)
WHERE r.event_slot_id IS NULL;

-- =====================
-- 6. Make event_slot_id NOT NULL
-- =====================
ALTER TABLE reservations ALTER COLUMN event_slot_id SET NOT NULL;

-- =====================
-- 7. Rebuild unique indexes
-- =====================
DROP INDEX IF EXISTS unique_active_reservation_student_number;
DROP INDEX IF EXISTS unique_active_reservation_university_email;

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_reservation_slot_student_number
  ON reservations (event_slot_id, student_number)
  WHERE (status != 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_reservation_slot_university_email
  ON reservations (event_slot_id, university_email)
  WHERE (status != 'cancelled');

-- =====================
-- 8. RPCs
-- =====================

-- 8-1. create_reservation (updated: now requires p_event_slot_id)
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

  -- Check event status
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

  -- Check slot capacity
  IF (SELECT count(*) FROM reservations WHERE event_slot_id = p_event_slot_id AND status != 'cancelled') >= v_slot.capacity THEN
    RAISE EXCEPTION 'この開催枠は定員に達しています。';
  END IF;

  -- Check duplicate reservations based on slot_selection_mode
  IF v_event.slot_selection_mode = 'single' THEN
    -- Single mode: check across ALL slots of this event
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND r.student_number = v_normalized_student_number
        AND r.status != 'cancelled'
    ) THEN
      RAISE EXCEPTION 'この学籍番号は既にこの企画を予約しています。';
    END IF;
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND r.university_email = v_normalized_email
        AND r.status != 'cancelled'
    ) THEN
      RAISE EXCEPTION 'このメールアドレスは既にこの企画を予約しています。';
    END IF;
  ELSE
    -- Multiple mode: check only THIS slot
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = p_event_slot_id
        AND student_number = v_normalized_student_number
        AND status != 'cancelled'
    ) THEN
      RAISE EXCEPTION 'この学籍番号は既にこの開催枠を予約しています。';
    END IF;
    IF EXISTS (
      SELECT 1 FROM reservations
      WHERE event_slot_id = p_event_slot_id
        AND university_email = v_normalized_email
        AND status != 'cancelled'
    ) THEN
      RAISE EXCEPTION 'このメールアドレスは既にこの開催枠を予約しています。';
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
    university_email, ticket_code, public_token, status
  ) VALUES (
    p_event_id, p_event_slot_id, trim(p_student_name), v_normalized_student_number,
    v_normalized_email, v_ticket_code, v_public_token, 'reserved'
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
    'created_at', v_new_reservation.created_at
  );
END;
$$;


-- 8-2. create_reservations_bulk (NEW: atomic multi-slot booking)
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

  -- Check event status
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

  -- Enforce single mode constraint
  IF v_event.slot_selection_mode = 'single' THEN
    IF array_length(p_event_slot_ids, 1) > 1 THEN
      RAISE EXCEPTION 'この企画は1枠のみ予約可能です。';
    END IF;
    -- Check if student already has any active reservation in this event
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND r.student_number = v_normalized_student_number
        AND r.status != 'cancelled'
    ) THEN
      RAISE EXCEPTION 'この学籍番号は既にこの企画を予約しています。';
    END IF;
    IF EXISTS (
      SELECT 1 FROM reservations r
      JOIN event_slots es ON r.event_slot_id = es.id
      WHERE es.event_id = p_event_id
        AND r.university_email = v_normalized_email
        AND r.status != 'cancelled'
    ) THEN
      RAISE EXCEPTION 'このメールアドレスは既にこの企画を予約しています。';
    END IF;
  END IF;

  -- Lock all requested slot rows (ordered to prevent deadlocks)
  -- Validate they all belong to this event and are enabled
  FOR v_slot IN
    SELECT * FROM event_slots
    WHERE id = ANY(p_event_slot_ids) AND event_id = p_event_id
    ORDER BY id
    FOR UPDATE
  LOOP
    -- Slot found, will be processed below
  END LOOP;

  -- Verify all requested slots were found
  IF (SELECT count(*) FROM event_slots WHERE id = ANY(p_event_slot_ids) AND event_id = p_event_id) != array_length(p_event_slot_ids, 1) THEN
    RAISE EXCEPTION '指定された開催枠の一部が見つからないか、この企画に属していません。';
  END IF;

  -- Initialize results array
  v_results := ARRAY[]::json[];

  -- Process each slot
  FOREACH v_slot_id IN ARRAY p_event_slot_ids
  LOOP
    -- Re-fetch slot (already locked above)
    SELECT * INTO v_slot FROM event_slots WHERE id = v_slot_id;

    IF NOT v_slot.is_enabled THEN
      RAISE EXCEPTION '開催枠「%」は現在受付停止中です。', v_slot.label;
    END IF;

    -- Check slot capacity
    IF (SELECT count(*) FROM reservations WHERE event_slot_id = v_slot_id AND status != 'cancelled') >= v_slot.capacity THEN
      RAISE EXCEPTION '開催枠「%」は定員に達しています。', v_slot.label;
    END IF;

    -- Check duplicate for multiple mode (per-slot check)
    IF v_event.slot_selection_mode = 'multiple' THEN
      IF EXISTS (
        SELECT 1 FROM reservations
        WHERE event_slot_id = v_slot_id
          AND student_number = v_normalized_student_number
          AND status != 'cancelled'
      ) THEN
        RAISE EXCEPTION '開催枠「%」は既に予約済みです。', v_slot.label;
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
      university_email, ticket_code, public_token, status
    ) VALUES (
      p_event_id, v_slot_id, trim(p_student_name), v_normalized_student_number,
      v_normalized_email, v_ticket_code, v_public_token, 'reserved'
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
      'created_at', v_new_reservation.created_at
    ));
  END LOOP;

  RETURN array_to_json(v_results);
END;
$$;


-- 8-3. get_event_slots (NEW)
CREATE OR REPLACE FUNCTION get_event_slots(p_event_id uuid)
RETURNS TABLE (
  id uuid,
  label text,
  starts_at timestamptz,
  ends_at timestamptz,
  capacity integer,
  is_enabled boolean,
  sort_order integer,
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
    es.capacity,
    es.is_enabled,
    es.sort_order,
    (es.capacity - COALESCE(count(r.id) FILTER (WHERE r.status != 'cancelled'), 0))::bigint AS remaining_slots
  FROM event_slots es
  LEFT JOIN reservations r ON es.id = r.event_slot_id
  WHERE es.event_id = p_event_id
  GROUP BY es.id
  ORDER BY es.sort_order, es.starts_at, es.created_at;
END;
$$;


-- 8-4. get_public_events (updated: remaining_slots from event_slots)
CREATE OR REPLACE FUNCTION get_public_events()
RETURNS TABLE (
  id uuid,
  title text,
  description text,
  capacity integer,
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
  remaining_slots bigint
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
    e.capacity,
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
    COALESCE(slot_stats.total_remaining, 0)::bigint AS remaining_slots
  FROM events e
  LEFT JOIN (
    SELECT
      es.event_id,
      SUM(
        GREATEST(es.capacity - COALESCE(res_counts.active_count, 0), 0)
      ) AS total_remaining
    FROM event_slots es
    LEFT JOIN (
      SELECT event_slot_id, count(*) AS active_count
      FROM reservations
      WHERE status != 'cancelled'
      GROUP BY event_slot_id
    ) res_counts ON es.id = res_counts.event_slot_id
    WHERE es.is_enabled = true
    GROUP BY es.event_id
  ) slot_stats ON e.id = slot_stats.event_id
  WHERE e.is_public = true
  ORDER BY e.created_at DESC;
END;
$$;


-- 8-5. get_ticket (updated: includes slot info)
CREATE OR REPLACE FUNCTION get_ticket(
  p_public_token text
)
RETURNS TABLE (
  reservation_id uuid,
  student_name text,
  student_number text,
  status text,
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
  slot_ends_at timestamptz
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
    es.ends_at AS slot_ends_at
  FROM reservations r
  JOIN events e ON r.event_id = e.id
  LEFT JOIN event_slots es ON r.event_slot_id = es.id
  WHERE r.public_token = p_public_token;
END;
$$;


-- 8-6. find_ticket (updated: normalize student number)
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


-- 8-7. use_ticket (no changes needed, included for completeness)
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
BEGIN
  SELECT r.*, e.use_starts_at, e.use_ends_at, e.ticket_enabled, e.use_button_enabled INTO v_reservation
  FROM reservations r
  JOIN events e ON r.event_id = e.id
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

  IF v_reservation.use_starts_at IS NOT NULL AND now() < v_reservation.use_starts_at THEN
    RAISE EXCEPTION 'チケット使用可能時間前です。';
  END IF;
  IF v_reservation.use_ends_at IS NOT NULL AND now() > v_reservation.use_ends_at THEN
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
