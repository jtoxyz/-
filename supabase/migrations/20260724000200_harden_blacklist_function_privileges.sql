BEGIN;

-- Trigger/helper functions are internal only. They must not be callable through PostgREST RPC.
REVOKE ALL ON FUNCTION public.normalize_blacklist_entry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_reservation_blacklist() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_blacklist_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_user_blacklisted(text, text) FROM PUBLIC, anon, authenticated;

-- Remove the obsolete event-only ticket finder. The current UI always supplies an event slot.
DROP FUNCTION IF EXISTS public.find_ticket(uuid, text, text, text);

NOTIFY pgrst, 'reload schema';
COMMIT;
