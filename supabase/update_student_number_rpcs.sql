-- ====================================================================
-- RUN THIS SQL SCRIPT IN THE SUPABASE SQL EDITOR TO UPDATE THE SYSTEM
-- TO THE NEW STUDENT ID SPECIFICATION.
-- ====================================================================

-- 1. Update create_reservation RPC
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

  -- Validate student number format (2 digits + 1 letter + 3 digits)
  IF NOT (v_normalized_student_number ~ '^\d{2}[A-Z]\d{3}$') THEN
    RAISE EXCEPTION '学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)';
  END IF;

  -- Verify email matches s + student number + @ge.osaka-sandai.ac.jp
  IF v_normalized_email != 's' || lower(v_normalized_student_number) || '@ge.osaka-sandai.ac.jp' THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しないか、無効なドメインです。（例：s24b123@ge.osaka-sandai.ac.jp）';
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


-- 2. Update find_ticket RPC
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
  -- Normalize student number
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
