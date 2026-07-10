-- Update create_reservation
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
  v_pre_reserved_count bigint;
  v_pre_walkin_count bigint;
BEGIN
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

  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'この開催枠は現在受付停止中です。';
  END IF;

  IF NOT v_slot.is_reservation_enabled THEN
    RAISE EXCEPTION '通常予約の受付期間外です。';
  END IF;
  IF v_slot.reservation_starts_at IS NOT NULL AND now() < v_slot.reservation_starts_at THEN
    RAISE EXCEPTION '通常予約の受付期間外です。';
  END IF;
  IF v_slot.reservation_ends_at IS NOT NULL AND now() > v_slot.reservation_ends_at THEN
    RAISE EXCEPTION '通常予約の受付期間外です。';
  END IF;

  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

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
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = 'reservation'
  ) THEN
    RAISE EXCEPTION 'この日はすでに予約済みです。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION '当日券取得済み：この日はすでに当日券を取得しているため、予約券は取得できません。';
  END IF;

  SELECT count(*) INTO v_active_reserved_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'reservation';

  SELECT count(*) INTO v_active_walkin_count
  FROM reservations
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'walkin';

  SELECT count(*) INTO v_pre_reserved_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation';

  SELECT count(*) INTO v_pre_walkin_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin';

  IF (v_active_reserved_count + v_pre_reserved_count) >= v_slot.reservation_capacity THEN
    RAISE EXCEPTION '予約券が定員に達しています。';
  END IF;

  IF (v_active_reserved_count + v_pre_reserved_count + v_active_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '予約券が定員に達しています。';
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
    p_event_id, p_event_slot_id, trim(p_student_name), v_normalized_student_number,
    v_normalized_email, v_ticket_code, v_public_token, 'reserved', 'reservation'
  ) RETURNING * INTO v_new_reservation;

  -- Attempt to auto-activate pre-registrations for this event whenever someone books
  PERFORM admin_auto_activate_pre_registrations(p_event_id);

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


-- Update create_walkin_reservation
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
  v_pre_reserved_count bigint;
  v_pre_walkin_count bigint;
BEGIN
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

  IF v_event.is_walkin_suspended OR (v_event.auto_suspend_at IS NOT NULL AND now() >= v_event.auto_suspend_at) THEN
    RAISE EXCEPTION '現在、当日券の発行を一時停止しています。';
  END IF;
  
  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;
  IF NOT v_slot.is_enabled THEN
    RAISE EXCEPTION 'この開催枠は現在受付停止中です。';
  END IF;

  IF NOT v_slot.is_walkin_enabled THEN
    RAISE EXCEPTION '当日券の発行期間外です';
  END IF;
  IF v_slot.walkin_starts_at IS NOT NULL AND now() < v_slot.walkin_starts_at THEN
    RAISE EXCEPTION '当日券の発行開始前です';
  END IF;
  IF v_slot.walkin_ends_at IS NOT NULL AND now() > v_slot.walkin_ends_at THEN
    RAISE EXCEPTION '当日券の発行は終了しました';
  END IF;

  v_email_domain := split_part(v_normalized_email, '@', 2);
  IF NOT (v_email_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = 'reservation'
  ) THEN
    RAISE EXCEPTION '予約済み：この日はすでに予約券を取得しているため、当日券は取得できません。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations
    WHERE event_slot_id = p_event_slot_id
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = 'walkin'
  ) THEN
    RAISE EXCEPTION '取得済み：この日の当日券はすでに取得済みです。';
  END IF;

  SELECT count(*) INTO v_reserved_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'reservation';
  
  SELECT count(*) INTO v_walkin_count 
  FROM reservations 
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'walkin';

  SELECT count(*) INTO v_pre_reserved_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation';

  SELECT count(*) INTO v_pre_walkin_count
  FROM admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin';

  IF (v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '満席のため当日券を発行できません';
  END IF;

  IF v_slot.walkin_limit IS NOT NULL AND (v_walkin_count + v_pre_walkin_count) >= v_slot.walkin_limit THEN
    RAISE EXCEPTION '満席のため当日券を発行できません';
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
    p_event_id, p_event_slot_id, trim(p_student_name), v_normalized_student_number,
    v_normalized_email, v_ticket_code, v_public_token, 'reserved', 'walkin'
  ) RETURNING * INTO v_new_reservation;

  PERFORM admin_auto_activate_pre_registrations(p_event_id);

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


-- Update use_ticket
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
  v_ticket_use_starts_at timestamptz;
  v_ticket_use_ends_at timestamptz;
  v_is_ticket_use_enabled boolean;
BEGIN
  SELECT * INTO v_reservation 
  FROM reservations 
  WHERE public_token = p_public_token 
  FOR UPDATE;

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

  SELECT * INTO v_event FROM events WHERE id = v_reservation.event_id;

  IF v_event.is_ticket_use_suspended OR (v_event.auto_suspend_at IS NOT NULL AND now() >= v_event.auto_suspend_at) THEN
    RAISE EXCEPTION '現在、チケットを使用できません。';
  END IF;

  SELECT 
    es.ticket_use_starts_at,
    es.ticket_use_ends_at,
    es.is_ticket_use_enabled
  INTO 
    v_ticket_use_starts_at,
    v_ticket_use_ends_at,
    v_is_ticket_use_enabled
  FROM event_slots es
  WHERE es.id = v_reservation.event_slot_id;

  IF v_event.ticket_enabled IS DISTINCT FROM true OR v_event.use_button_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'このイベントではチケットの使用ボタンが有効化されていません。';
  END IF;

  IF v_is_ticket_use_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'このチケットは使用不可に設定されています。';
  END IF;

  IF v_ticket_use_starts_at IS NOT NULL AND now() < v_ticket_use_starts_at THEN
    RAISE EXCEPTION 'このチケットはまだ使用できません';
  END IF;
  IF v_ticket_use_ends_at IS NOT NULL AND now() > v_ticket_use_ends_at THEN
    RAISE EXCEPTION 'このチケットの使用可能時間は終了しました';
  END IF;

  UPDATE reservations
  SET status = 'used', used_at = now()
  WHERE id = v_reservation.id AND status = 'reserved'
  RETURNING * INTO v_reservation;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'チケットはすでに使用されています。';
  END IF;

  RETURN json_build_object(
    'status', v_reservation.status,
    'used_at', v_reservation.used_at
  );
END;
$$;

-- Helper to auto-activate pre-registrations
CREATE OR REPLACE FUNCTION admin_auto_activate_pre_registrations(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pre record;
  v_slot record;
  v_public_token text;
  v_ticket_code text;
BEGIN
  -- We don't want this to fail the main transaction if it errors out individually,
  -- but plpgsql doesn't have try-catch without EXCEPTION blocks that rollback the subtransaction.
  -- We will just do safe checks and if it's clear, we insert. If there is a violation, we mark as failed.
  
  FOR v_pre IN 
    SELECT * FROM admin_pre_registrations 
    WHERE event_id = p_event_id AND status = 'reserved'
    FOR UPDATE
  LOOP
    SELECT * INTO v_slot FROM event_slots WHERE id = v_pre.event_slot_id;
    
    -- Check if it's time to activate
    IF v_pre.ticket_type = 'reservation' THEN
      IF v_slot.reservation_starts_at IS NOT NULL AND now() < v_slot.reservation_starts_at THEN
        CONTINUE; -- Not time yet
      END IF;
    ELSIF v_pre.ticket_type = 'walkin' THEN
      IF v_slot.walkin_starts_at IS NOT NULL AND now() < v_slot.walkin_starts_at THEN
        CONTINUE; -- Not time yet
      END IF;
    END IF;

    -- Time to activate! Check duplicates.
    IF EXISTS (
      SELECT 1 FROM reservations 
      WHERE event_id = p_event_id 
        AND (student_number = v_pre.student_number OR university_email = v_pre.university_email)
        AND status IN ('reserved', 'used')
        AND ticket_type = v_pre.ticket_type
    ) THEN
      UPDATE admin_pre_registrations SET status = 'activation_failed', activation_error = 'すでに同じ券種の予約が存在します' WHERE id = v_pre.id;
      CONTINUE;
    END IF;
    
    -- It's safe to activate
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
      p_event_id, v_pre.event_slot_id, v_pre.student_name, v_pre.student_number,
      v_pre.university_email, v_ticket_code, v_public_token, 'reserved', v_pre.ticket_type
    );

    UPDATE admin_pre_registrations SET status = 'active', activated_at = now() WHERE id = v_pre.id;
  END LOOP;
END;
$$;

-- Create Pre-registration
CREATE OR REPLACE FUNCTION admin_create_pre_registration(
  p_event_id uuid,
  p_event_slot_id uuid,
  p_student_name text,
  p_student_number text,
  p_university_email text,
  p_ticket_type text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized_student_number text;
  v_normalized_email text;
  v_slot record;
  v_reserved_count bigint;
  v_walkin_count bigint;
  v_pre_reserved_count bigint;
  v_pre_walkin_count bigint;
  v_new_pre record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'アクセス権限がありません。';
  END IF;

  v_normalized_student_number := upper(trim(p_student_number));
  IF v_normalized_student_number LIKE 'S%' THEN
    v_normalized_student_number := substring(v_normalized_student_number from 2);
  END IF;
  v_normalized_email := lower(trim(p_university_email));

  IF NOT (v_normalized_student_number ~ '^\d{2}[A-Z]\d{3}$') THEN
    RAISE EXCEPTION '学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)';
  END IF;
  IF split_part(v_normalized_email, '@', 1) != 's' || lower(v_normalized_student_number) THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しません。';
  END IF;

  SELECT * INTO v_slot FROM event_slots WHERE id = p_event_slot_id AND event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定された開催枠が見つかりません。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM reservations 
    WHERE event_id = p_event_id 
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'used')
      AND ticket_type = p_ticket_type
  ) THEN
    RAISE EXCEPTION 'すでに同じ券種の予約が存在します。';
  END IF;

  IF EXISTS (
    SELECT 1 FROM admin_pre_registrations 
    WHERE event_id = p_event_id 
      AND (student_number = v_normalized_student_number OR university_email = v_normalized_email)
      AND status IN ('reserved', 'active', 'activation_failed')
      AND ticket_type = p_ticket_type
  ) THEN
    RAISE EXCEPTION 'すでに同じ券種の事前登録が存在します。';
  END IF;

  SELECT count(*) INTO v_reserved_count FROM reservations WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_walkin_count FROM reservations WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'used') AND ticket_type = 'walkin';
  SELECT count(*) INTO v_pre_reserved_count FROM admin_pre_registrations WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_pre_walkin_count FROM admin_pre_registrations WHERE event_slot_id = p_event_slot_id AND status IN ('reserved', 'active', 'activation_failed') AND ticket_type = 'walkin';

  IF p_ticket_type = 'reservation' THEN
    IF (v_reserved_count + v_pre_reserved_count) >= v_slot.reservation_capacity THEN
      RAISE EXCEPTION '予約券が定員に達しています。';
    END IF;
  ELSIF p_ticket_type = 'walkin' THEN
    IF v_slot.walkin_limit IS NOT NULL AND (v_walkin_count + v_pre_walkin_count) >= v_slot.walkin_limit THEN
      RAISE EXCEPTION '満席のため当日券を発行できません';
    END IF;
  END IF;

  IF (v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '全体の定員に達しています。';
  END IF;

  INSERT INTO admin_pre_registrations (
    event_id, event_slot_id, student_name, student_number, university_email, ticket_type
  ) VALUES (
    p_event_id, p_event_slot_id, trim(p_student_name), v_normalized_student_number, v_normalized_email, p_ticket_type
  ) RETURNING * INTO v_new_pre;

  PERFORM admin_auto_activate_pre_registrations(p_event_id);

  RETURN json_build_object(
    'id', v_new_pre.id,
    'status', v_new_pre.status,
    'ticket_type', v_new_pre.ticket_type
  );
END;
$$;
