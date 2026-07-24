BEGIN;

CREATE POLICY events_authenticated_public_read
ON public.events
FOR SELECT
TO authenticated
USING (is_public = true);

CREATE POLICY event_slots_authenticated_public_read
ON public.event_slots
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.events e
    WHERE e.id = event_slots.event_id
      AND e.is_public = true
  )
);

NOTIFY pgrst, 'reload schema';
COMMIT;
