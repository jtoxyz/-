-- Consolidate the production database state without removing legacy columns.
-- This migration records the fixes currently required by the frontend and
-- keeps backward-compatible fields in place so existing features continue to work.

BEGIN;

-- 1. Columns used by current reservation/admin flows.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS department text;

ALTER TABLE public.admin_pre_registrations
  ADD COLUMN IF NOT EXISTS department text;

-- 2. Always generate the required ticket identifiers at table level.
CREATE OR REPLACE FUNCTION public.ensure_reservation_tokens()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.public_token IS NULL OR btrim(NEW.public_token) = '' THEN
    NEW.public_token := gen_random_uuid()::text;
  END IF;

  IF NEW.ticket_code IS NULL OR btrim(NEW.ticket_code) = '' THEN
    LOOP
      NEW.ticket_code := upper(substr(md5(gen_random_uuid()::text), 1, 8));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.reservations r WHERE r.ticket_code = NEW.ticket_code
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_ensure_tokens ON public.reservations;
CREATE TRIGGER reservations_ensure_tokens
BEFORE INSERT ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.ensure_reservation_tokens();

-- 3. Remove the obsolete five-argument overload that caused PostgREST ambiguity.
DROP FUNCTION IF EXISTS public.create_reservation(uuid, uuid, text, text, text);

-- Recreate the current reservation RPC with a JSON response expected by the frontend.
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
  v_reservation public.reservations%ROWTYPE;
  v_slot public.event_slots%ROWTYPE;
  v_reserved_count integer;
  v_walkin_count integer;
  v_pre_reserved_count integer;
  v_pre_walkin_count integer;
BEGIN
  SELECT *
  INTO v_slot
  FROM public.event_slots
  WHERE id = p_event_slot_id
    AND event_id = p_event_id
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

  SELECT count(*) INTO v_reserved_count
  FROM public.reservations
  WHERE event_slot_id = p_event_slot_id
    AND status <> 'cancelled'
    AND ticket_type = 'reservation';

  SELECT count(*) INTO v_walkin_count
  FROM public.reservations
  WHERE event_slot_id = p_event_slot_id
    AND status <> 'cancelled'
    AND ticket_type = 'walkin';

  SELECT count(*) INTO v_pre_reserved_count
  FROM public.admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id
    AND status <> 'cancelled'
    AND ticket_type = 'reservation';

  SELECT count(*) INTO v_pre_walkin_count
  FROM public.admin_pre_registrations
  WHERE event_slot_id = p_event_slot_id
    AND status <> 'cancelled'
    AND ticket_type = 'walkin';

  IF (v_reserved_count + v_pre_reserved_count) >= COALESCE(v_slot.reservation_capacity, v_slot.total_capacity) THEN
    RAISE EXCEPTION '予約枠の定員に達しました。';
  END IF;

  IF (v_reserved_count + v_pre_reserved_count + v_walkin_count + v_pre_walkin_count) >= v_slot.total_capacity THEN
    RAISE EXCEPTION '開催枠の総参加上限に達しました。';
  END IF;

  INSERT INTO public.reservations (
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
    btrim(p_student_name),
    upper(btrim(p_student_number)),
    lower(btrim(p_university_email)),
    p_department,
    'reservation',
    'reserved'
  )
  RETURNING * INTO v_reservation;

  RETURN jsonb_build_object(
    'id', v_reservation.id,
    'event_id', v_reservation.event_id,
    'event_slot_id', v_reservation.event_slot_id,
    'ticket_code', v_reservation.ticket_code,
    'public_token', v_reservation.public_token,
    'status', v_reservation.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, uuid, text, text, text, text) TO anon, authenticated;

-- 4. Keep the ticket RPC contract aligned with the ticket page and avoid
-- ambiguous references between output-column names and table columns.
DROP FUNCTION IF EXISTS public.get_ticket(text);
CREATE FUNCTION public.get_ticket(p_public_token text)
RETURNS TABLE(
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
  slot_reservation_use_starts_at timestamptz,
  slot_reservation_use_ends_at timestamptz,
  slot_walkin_use_starts_at timestamptz,
  slot_walkin_use_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  SELECT r.event_id
  INTO v_event_id
  FROM public.reservations r
  WHERE r.public_token = p_public_token;

  IF v_event_id IS NOT NULL THEN
    PERFORM public.admin_auto_activate_pre_registrations(v_event_id);
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.student_name,
    r.student_number,
    r.status,
    r.ticket_type,
    r.ticket_code,
    r.public_token,
    r.used_at,
    r.cancelled_at,
    r.created_at,
    e.id,
    e.title,
    e.description,
    e.starts_at,
    e.ends_at,
    e.use_starts_at,
    e.use_ends_at,
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
    es.id,
    es.label,
    es.starts_at,
    es.ends_at,
    es.reservation_starts_at,
    es.reservation_ends_at,
    es.ticket_use_starts_at,
    es.ticket_use_ends_at,
    es.walkin_starts_at,
    es.walkin_ends_at,
    es.is_reservation_enabled,
    es.is_ticket_use_enabled,
    es.is_walkin_enabled,
    es.ticket_use_starts_at,
    es.ticket_use_ends_at,
    es.walkin_starts_at,
    es.walkin_ends_at
  FROM public.reservations r
  JOIN public.events e ON e.id = r.event_id
  LEFT JOIN public.event_slots es ON es.id = r.event_slot_id
  WHERE r.public_token = p_public_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_ticket(text) TO anon, authenticated;

-- 5. Non-destructive performance indexes.
CREATE INDEX IF NOT EXISTS idx_event_slots_event_id
  ON public.event_slots(event_id);
CREATE INDEX IF NOT EXISTS idx_reservations_event_id
  ON public.reservations(event_id);
CREATE INDEX IF NOT EXISTS idx_reservations_event_slot_id
  ON public.reservations(event_slot_id);
CREATE INDEX IF NOT EXISTS idx_admin_pre_registrations_event_id
  ON public.admin_pre_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_admin_pre_registrations_event_slot_id
  ON public.admin_pre_registrations(event_slot_id);

-- 6. Admin-only RPCs must not be callable by anonymous visitors.
REVOKE EXECUTE ON FUNCTION public.admin_auto_activate_pre_registrations(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_pre_registration(uuid, uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_duplicate_event(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_export_event_backup(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_event_slots(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_restore_event_backup(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_event_admin(uuid) FROM anon;

-- Keep mutable search_path warnings away for known functions.
ALTER FUNCTION public.calculate_slot_status(public.event_slots) SET search_path = public;
ALTER FUNCTION public.create_walkin_reservation(uuid, uuid, text, text, text, text) SET search_path = public;
ALTER FUNCTION public.admin_create_pre_registration(uuid, uuid, text, text, text, text) SET search_path = public;

NOTIFY pgrst, 'reload schema';

COMMIT;
