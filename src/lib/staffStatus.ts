import type { SupabaseClient } from '@supabase/supabase-js';

/** ログイン中のアカウントがスタッフか管理者か。取れないときは false。 */
export async function fetchIsStaffOrAdmin(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.rpc('get_my_staff_status');
    if (error) return false;
    const row = (Array.isArray(data) ? data[0] : data) as { is_staff?: boolean; is_admin?: boolean } | null | undefined;
    return Boolean(row?.is_staff || row?.is_admin);
  } catch {
    return false;
  }
}
