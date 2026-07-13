BEGIN;

-- Keep legacy columns and features, but allow a slot to be configured as walk-in only.
ALTER TABLE public.event_slots DROP CONSTRAINT IF EXISTS event_slots_capacity_check;
ALTER TABLE public.event_slots
  ADD CONSTRAINT event_slots_capacity_check CHECK (reservation_capacity >= 0);

-- Canonical single-slot reservation RPC.
DROP FUNCTION IF EXISTS public.create_reservation(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.create_reservation(uuid, uuid, text, text, text, text);
CREATE FUNCTION public.create_reservation(
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
SET search_path = public
AS $$
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
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','active','activation_failed') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_pre_walkin_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','active','activation_failed') AND ticket_type = 'walkin';

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
$$;

-- Canonical walk-in RPC, aligned with the frontend's snake_case contract.
DROP FUNCTION IF EXISTS public.create_walkin_reservation(uuid, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.create_walkin_reservation(uuid, uuid, text, text, text, text);
CREATE FUNCTION public.create_walkin_reservation(
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
SET search_path = public
AS $$
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
    RAISE EXCEPTION '学籍番号の形式が正しくありません。';
  END IF;
  IF split_part(v_email, '@', 1) <> 's' || lower(v_student_number) THEN
    RAISE EXCEPTION 'メールアドレスが学籍番号と一致しません。';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_event_id::text || ':' || v_student_number, 0));

  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND OR v_event.is_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION '企画が見つからないか、公開されていません。';
  END IF;
  IF v_event.is_walkin_suspended IS TRUE
     OR (v_event.auto_suspend_at IS NOT NULL AND now() >= v_event.auto_suspend_at) THEN
    RAISE EXCEPTION '現在、当日券の発行を停止しています。';
  END IF;

  v_domain := split_part(v_email, '@', 2);
  IF v_event.allowed_email_domains IS NOT NULL
     AND NOT (v_domain = ANY(SELECT lower(d) FROM unnest(v_event.allowed_email_domains) AS d)) THEN
    RAISE EXCEPTION '許可されていないメールアドレスのドメインです。';
  END IF;

  SELECT * INTO v_slot FROM public.event_slots
  WHERE id = p_event_slot_id AND event_id = p_event_id
  FOR UPDATE;
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

  IF EXISTS (
    SELECT 1 FROM public.reservations r
    WHERE r.event_slot_id = p_event_slot_id
      AND (r.student_number = v_student_number OR r.university_email = v_email)
      AND r.status IN ('reserved','used')
      AND r.ticket_type IN ('reservation','walkin')
  ) THEN
    RAISE EXCEPTION 'この開催枠の予約券または当日券をすでに取得しています。';
  END IF;

  SELECT count(*) INTO v_reserved_count FROM public.reservations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','used') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_walkin_count FROM public.reservations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','used') AND ticket_type = 'walkin';
  SELECT count(*) INTO v_pre_reserved_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','active','activation_failed') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_pre_walkin_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','active','activation_failed') AND ticket_type = 'walkin';

  IF v_walkin_count + v_pre_walkin_count >= COALESCE(v_slot.walkin_limit, v_slot.total_capacity) THEN
    RAISE EXCEPTION '当日券の発行上限に達しました。';
  END IF;
  IF v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO public.reservations (
    event_id, event_slot_id, student_name, student_number,
    university_email, department, ticket_type, status
  ) VALUES (
    p_event_id, p_event_slot_id, btrim(p_student_name), v_student_number,
    v_email, NULLIF(btrim(p_department), ''), 'walkin', 'reserved'
  ) RETURNING * INTO v_reservation;

  RETURN jsonb_build_object(
    'id', v_reservation.id,
    'event_id', v_reservation.event_id,
    'event_slot_id', v_reservation.event_slot_id,
    'ticket_code', v_reservation.ticket_code,
    'public_token', v_reservation.public_token,
    'publicToken', v_reservation.public_token,
    'status', v_reservation.status,
    'created_at', v_reservation.created_at
  );
END;
$$;

-- Repair admin pre-registration authentication (admin_users uses user_id, not id).
CREATE OR REPLACE FUNCTION public.admin_create_pre_registration(
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
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_slot public.event_slots%ROWTYPE;
  v_reserved_count bigint;
  v_walkin_count bigint;
  v_pre_reserved_count bigint;
  v_pre_walkin_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION '管理権限がありません。';
  END IF;
  IF p_ticket_type NOT IN ('reservation','walkin') THEN
    RAISE EXCEPTION '券種が正しくありません。';
  END IF;

  SELECT * INTO v_slot FROM public.event_slots
  WHERE id = p_event_slot_id AND event_id = p_event_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '開催枠が見つかりません。';
  END IF;

  SELECT count(*) INTO v_reserved_count FROM public.reservations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','used') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_walkin_count FROM public.reservations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','used') AND ticket_type = 'walkin';
  SELECT count(*) INTO v_pre_reserved_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','active','activation_failed') AND ticket_type = 'reservation';
  SELECT count(*) INTO v_pre_walkin_count FROM public.admin_pre_registrations
   WHERE event_slot_id = p_event_slot_id AND status IN ('reserved','active','activation_failed') AND ticket_type = 'walkin';

  IF p_ticket_type = 'reservation'
     AND v_reserved_count + v_pre_reserved_count >= v_slot.reservation_capacity THEN
    RAISE EXCEPTION '予約枠の定員に達しました。';
  END IF;
  IF p_ticket_type = 'walkin'
     AND v_walkin_count + v_pre_walkin_count >= COALESCE(v_slot.walkin_limit, v_slot.total_capacity) THEN
    RAISE EXCEPTION '当日券の発行上限に達しました。';
  END IF;
  IF v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO public.admin_pre_registrations (
    event_id, event_slot_id, student_name, student_number,
    university_email, ticket_type, status
  ) VALUES (
    p_event_id, p_event_slot_id, btrim(p_student_name), upper(btrim(p_student_number)),
    lower(btrim(p_university_email)), p_ticket_type, 'reserved'
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Harden function execution paths and privileges without removing public features.
ALTER FUNCTION public.calculate_slot_status(boolean, boolean, timestamptz, timestamptz, integer, bigint, integer, text, text, boolean, timestamptz) SET search_path = public;
ALTER FUNCTION public.create_reservations_bulk(uuid, uuid[], text, text, text) SET search_path = public;
ALTER FUNCTION public.get_event_slots(uuid) SET search_path = public;
ALTER FUNCTION public.get_public_events() SET search_path = public;
ALTER FUNCTION public.get_ticket(text) SET search_path = public;
ALTER FUNCTION public.use_ticket(text) SET search_path = public;
ALTER FUNCTION public.find_ticket(uuid, text, text, text) SET search_path = public;
ALTER FUNCTION public.admin_auto_activate_pre_registrations(uuid) SET search_path = public;
ALTER FUNCTION public.delete_event_admin(uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.admin_create_pre_registration(uuid, uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_auto_activate_pre_registrations(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_duplicate_event(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_export_event_backup(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_event_slots(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_restore_event_backup(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_event_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_pre_registration(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_auto_activate_pre_registrations(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_duplicate_event(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_export_event_backup(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_event_slots(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_restore_event_backup(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_event_admin(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, uuid, text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_walkin_reservation(uuid, uuid, text, text, text, text) TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_event_slots_event_id ON public.event_slots(event_id);
CREATE INDEX IF NOT EXISTS idx_reservations_event_id ON public.reservations(event_id);
CREATE INDEX IF NOT EXISTS idx_reservations_event_slot_id ON public.reservations(event_slot_id);
CREATE INDEX IF NOT EXISTS idx_admin_pre_registrations_event_id ON public.admin_pre_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_admin_pre_registrations_event_slot_id ON public.admin_pre_registrations(event_slot_id);

NOTIFY pgrst, 'reload schema';
COMMIT;
