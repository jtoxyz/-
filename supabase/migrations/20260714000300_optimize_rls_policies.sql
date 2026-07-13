BEGIN;

DROP POLICY IF EXISTS admin_users_read ON public.admin_users;
CREATE POLICY admin_users_read ON public.admin_users
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS events_admin_all ON public.events;
CREATE POLICY events_admin_all ON public.events
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS reservations_admin_all ON public.reservations;
CREATE POLICY reservations_admin_all ON public.reservations
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS event_slots_admin_all ON public.event_slots;
CREATE POLICY event_slots_admin_all ON public.event_slots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Admin full access on admin_pre_registrations" ON public.admin_pre_registrations;
CREATE POLICY "Admin full access on admin_pre_registrations"
  ON public.admin_pre_registrations
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_users au
    WHERE au.user_id = (SELECT auth.uid())
  ));

-- Anonymous visitors need public event data; authenticated admins use admin policies.
DROP POLICY IF EXISTS events_public_read ON public.events;
CREATE POLICY events_public_read ON public.events
  FOR SELECT TO anon
  USING (is_public = true);

DROP POLICY IF EXISTS event_slots_public_read ON public.event_slots;
CREATE POLICY event_slots_public_read ON public.event_slots
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_slots.event_id AND e.is_public = true
  ));

COMMIT;
