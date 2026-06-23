-- 1. Create tables

-- admin_users table
CREATE TABLE admin_users (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz DEFAULT now()
);

-- events table
CREATE TABLE events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    capacity integer NOT NULL CHECK (capacity > 0),
    starts_at timestamptz,
    ends_at timestamptz,
    reservation_starts_at timestamptz,
    reservation_ends_at timestamptz,
    is_public boolean DEFAULT false,
    reservation_enabled boolean DEFAULT true,
    ticket_enabled boolean DEFAULT false,
    use_button_enabled boolean DEFAULT false,
    use_starts_at timestamptz,
    use_ends_at timestamptz,
    allowed_email_domains text[] DEFAULT ARRAY['ge.osaka-sandai.ac.jp'::text],
    survey_after_reservation_enabled boolean DEFAULT false,
    survey_after_reservation_url text,
    survey_after_reservation_message text,
    survey_after_use_enabled boolean DEFAULT false,
    survey_after_use_url text,
    survey_after_use_message text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- reservations table
CREATE TABLE reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    student_name text NOT NULL,
    student_number text NOT NULL,
    university_email text NOT NULL,
    ticket_code text UNIQUE NOT NULL,
    public_token text UNIQUE NOT NULL,
    status text NOT NULL DEFAULT 'reserved' CONSTRAINT check_status CHECK (status IN ('reserved', 'used', 'cancelled')),
    used_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- 2. Create conditional unique indexes for reservations (prevent active duplicates, allow booking again if cancelled)
CREATE UNIQUE INDEX unique_active_reservation_student_number 
ON reservations (event_id, student_number) 
WHERE (status != 'cancelled');

CREATE UNIQUE INDEX unique_active_reservation_university_email 
ON reservations (event_id, university_email) 
WHERE (status != 'cancelled');

-- 3. Row Level Security (RLS)
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Policies for admin_users
CREATE POLICY admin_users_read ON admin_users 
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Policies for events
CREATE POLICY events_public_read ON events 
    FOR SELECT USING (is_public = true);

CREATE POLICY events_admin_all ON events 
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
    );

-- Policies for reservations
-- Allow admin users full access
CREATE POLICY reservations_admin_all ON reservations 
    FOR ALL TO authenticated USING (
        EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
    );
-- Note: Anonymous users have no SELECT, INSERT, UPDATE, or DELETE policies on reservations.
-- All anonymous reservation requests are routed securely via RPCs.


-- 4. RPC Functions

-- create_reservation RPC
CREATE OR REPLACE FUNCTION create_reservation(
  p_event_id uuid,
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
  v_active_count integer;
  v_normalized_student_number text;
  v_normalized_email text;
  v_email_domain text;
  v_public_token text;
  v_ticket_code text;
  v_new_reservation record;
BEGIN
  -- Normalize inputs
  v_normalized_student_number := upper(trim(p_student_number));
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

  -- Fetch and lock event row to prevent race conditions
  SELECT * INTO v_event FROM events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '企画が見つかりません。';
  END IF;

  -- Check if event is open for reservations
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

  -- Validate email domain (lower-case domains for case-insensitive matching)
  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  -- Check existing active reservations for student_number and email
  IF EXISTS (
    SELECT 1 FROM reservations 
    WHERE event_id = p_event_id 
      AND student_number = v_normalized_student_number 
      AND status != 'cancelled'
  ) THEN
    RAISE EXCEPTION 'この学籍番号は既にこの企画を予約しています。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations 
    WHERE event_id = p_event_id 
      AND university_email = v_normalized_email 
      AND status != 'cancelled'
  ) THEN
    RAISE EXCEPTION 'このメールアドレスは既にこの企画を予約しています。';
  END IF;

  -- Check capacity
  SELECT count(*) INTO v_active_count FROM reservations 
  WHERE event_id = p_event_id AND status != 'cancelled';
  
  IF v_active_count >= v_event.capacity THEN
    RAISE EXCEPTION '定員に達したため、予約できません。';
  END IF;

  -- Generate tokens
  v_public_token := gen_random_uuid()::text;
  
  -- Generate an 8-character unique alphanumeric code for the ticket
  LOOP
    v_ticket_code := upper(substring(md5(random()::text) from 1 for 8));
    IF NOT EXISTS (SELECT 1 FROM reservations WHERE ticket_code = v_ticket_code) THEN
      EXIT;
    END IF;
  END LOOP;

  -- Insert reservation
  INSERT INTO reservations (
    event_id,
    student_name,
    student_number,
    university_email,
    ticket_code,
    public_token,
    status
  ) VALUES (
    p_event_id,
    trim(p_student_name),
    v_normalized_student_number,
    v_normalized_email,
    v_ticket_code,
    v_public_token,
    'reserved'
  ) RETURNING * INTO v_new_reservation;

  RETURN json_build_object(
    'id', v_new_reservation.id,
    'event_id', v_new_reservation.event_id,
    'student_name', v_new_reservation.student_name,
    'student_number', v_new_reservation.student_number,
    'ticket_code', v_new_reservation.ticket_code,
    'public_token', v_new_reservation.public_token,
    'status', v_new_reservation.status,
    'created_at', v_new_reservation.created_at
  );
END;
$$;

-- use_ticket RPC
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
  v_event record;
BEGIN
  -- Find reservation and check if exists
  SELECT r.*, e.use_starts_at, e.use_ends_at, e.ticket_enabled, e.use_button_enabled INTO v_reservation 
  FROM reservations r
  JOIN events e ON r.event_id = e.id
  WHERE r.public_token = p_public_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットが見つかりません。';
  END IF;

  -- Check if cancelled
  IF v_reservation.status = 'cancelled' THEN
    RAISE EXCEPTION 'このチケットはキャンセルされています。';
  END IF;

  -- Check if already used
  IF v_reservation.status = 'used' THEN
    RETURN json_build_object(
      'status', 'used',
      'used_at', v_reservation.used_at
    );
  END IF;

  -- Check if ticket and use button are enabled
  IF NOT v_reservation.ticket_enabled OR NOT v_reservation.use_button_enabled THEN
    RAISE EXCEPTION 'このイベントではチケットの使用ボタンが有効化されていません。';
  END IF;

  -- Check usage time limits (if null, no restriction in that direction)
  IF v_reservation.use_starts_at IS NOT NULL AND now() < v_reservation.use_starts_at THEN
    RAISE EXCEPTION 'チケット使用可能時間前です。';
  END IF;
  IF v_reservation.use_ends_at IS NOT NULL AND now() > v_reservation.use_ends_at THEN
    RAISE EXCEPTION 'チケット使用可能時間を過ぎています。';
  END IF;

  -- Update ticket status
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

-- get_ticket RPC (excludes university_email, includes reservation surveys)
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
  survey_after_use_message text
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
    e.survey_after_use_message
  FROM reservations r
  JOIN events e ON r.event_id = e.id
  WHERE r.public_token = p_public_token;
END;
$$;

-- find_ticket RPC
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
BEGIN
  SELECT public_token INTO v_public_token
  FROM reservations
  WHERE event_id = p_event_id
    AND student_name = trim(p_student_name)
    AND student_number = upper(trim(p_student_number))
    AND university_email = lower(trim(p_university_email))
    AND status != 'cancelled'
  LIMIT 1;

  RETURN v_public_token;
END;
$$;

-- get_public_events RPC (returns public events with calculated remaining slots securely)
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
    e.survey_after_reservation_enabled,
    e.survey_after_reservation_url,
    e.survey_after_reservation_message,
    e.survey_after_use_enabled,
    e.survey_after_use_url,
    e.survey_after_use_message,
    e.created_at,
    (e.capacity - COALESCE(count(r.id) FILTER (WHERE r.status != 'cancelled'), 0))::bigint AS remaining_slots
  FROM events e
  LEFT JOIN reservations r ON e.id = r.event_id
  WHERE e.is_public = true
  GROUP BY e.id
  ORDER BY e.created_at DESC;
END;
$$;
