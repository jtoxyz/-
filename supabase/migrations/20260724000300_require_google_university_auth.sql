BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_verified_university_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email text;
  v_student_number text;
  v_role text;
BEGIN
  v_role := COALESCE(current_setting('request.jwt.claim.role', true), '');

  -- Service-role and administrators may create/manage records without student OAuth.
  IF v_role = 'service_role' OR EXISTS (
    SELECT 1 FROM public.admin_users au WHERE au.user_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '大学Googleアカウントでログインしてください。';
  END IF;

  SELECT lower(u.email)
    INTO v_email
    FROM auth.users u
   WHERE u.id = auth.uid()
     AND u.email_confirmed_at IS NOT NULL;

  IF v_email IS NULL THEN
    RAISE EXCEPTION '確認済みの大学Googleアカウントが必要です。';
  END IF;

  IF v_email !~ '^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$' THEN
    RAISE EXCEPTION '大阪産業大学のGoogleアカウントでログインしてください。';
  END IF;

  v_student_number := upper(substring(v_email from '^s([0-9]{2}[a-z][0-9]{3})@'));
  NEW.university_email := v_email;
  NEW.student_number := v_student_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reservations_verified_university_identity ON public.reservations;
CREATE TRIGGER reservations_verified_university_identity
BEFORE INSERT ON public.reservations
FOR EACH ROW EXECUTE FUNCTION public.enforce_verified_university_identity();

REVOKE ALL ON FUNCTION public.enforce_verified_university_identity() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_walkin_reservation(uuid, uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_reservations_bulk(uuid, uuid[], text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_walkin_reservation(uuid, uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_reservations_bulk(uuid, uuid[], text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
