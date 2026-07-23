BEGIN;

-- Select the exact reservation/walk-in ticket for the chosen event slot.
-- Keeping the slot in the lookup prevents a reservation ticket from being
-- returned when the same student also has a walk-in ticket for another day.
DROP FUNCTION IF EXISTS public.find_ticket(uuid, uuid, text, text, text);
CREATE FUNCTION public.find_ticket(
  p_event_id uuid,
  p_event_slot_id uuid,
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
  v_student_number text;
  v_email text;
BEGIN
  v_student_number := upper(regexp_replace(btrim(COALESCE(p_student_number, '')), '\s+', '', 'g'));
  IF v_student_number LIKE 'S%' THEN
    v_student_number := substr(v_student_number, 2);
  END IF;
  v_email := lower(btrim(COALESCE(p_university_email, '')));

  SELECT r.public_token
    INTO v_public_token
  FROM public.reservations r
  WHERE r.event_id = p_event_id
    AND r.event_slot_id = p_event_slot_id
    AND r.student_name = btrim(p_student_name)
    AND r.student_number = v_student_number
    AND r.university_email = v_email
    AND r.status IN ('reserved', 'used')
  ORDER BY r.created_at DESC
  LIMIT 1;

  RETURN v_public_token;
END;
$$;

REVOKE ALL ON FUNCTION public.find_ticket(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_ticket(uuid, uuid, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
