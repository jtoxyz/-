-- Re-apply anon EXECUTE revokes on admin-only RPCs.
-- These were correctly revoked when first created, but production drifted so that
-- `anon` could still call them (blocked only by the internal admin_users check).
-- This migration restores defense-in-depth by matching the DB grants to the
-- original intent in 20260725013000_payment_management_foundation.sql and
-- 20260725023000_make_dynamic_payment_qr_single_use.sql.

revoke execute on function public.admin_set_reservation_payment_status(uuid, boolean) from anon;
revoke execute on function public.admin_expire_unpaid_reservations() from anon;
revoke execute on function public.admin_get_current_dynamic_payment_qr(uuid) from anon;
