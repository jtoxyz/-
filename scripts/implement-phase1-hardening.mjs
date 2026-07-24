import fs from 'node:fs';

const migrationPath = 'supabase/migrations/20260724000200_harden_blacklist_function_privileges.sql';
const migration = `BEGIN;

-- Trigger/helper functions are internal only. They must not be callable through PostgREST RPC.
REVOKE ALL ON FUNCTION public.normalize_blacklist_entry() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_reservation_blacklist() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_blacklist_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_user_blacklisted(text, text) FROM PUBLIC, anon, authenticated;

-- Remove the obsolete event-only ticket finder. The current UI always supplies an event slot.
DROP FUNCTION IF EXISTS public.find_ticket(uuid, text, text, text);

NOTIFY pgrst, 'reload schema';
COMMIT;
`;

if (fs.existsSync(migrationPath)) {
  const current = fs.readFileSync(migrationPath, 'utf8');
  if (current !== migration) {
    throw new Error(`${migrationPath} already exists with different contents`);
  }
} else {
  fs.mkdirSync('supabase/migrations', { recursive: true });
  fs.writeFileSync(migrationPath, migration, 'utf8');
}

console.log('Phase 1 security hardening migration prepared.');
