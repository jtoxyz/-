import { supabase } from '@/lib/supabase';

/** 予約者本人の利用状態（支払いに来なかった回数・イエロー／ブラックリスト） */
export type AccessStatus = {
  noshow_count: number;
  level: 'normal' | 'yellow' | 'blacklisted';
  blacklist_reason: string | null;
  blacklist_expires_at: string | null;
};

/** 来なかった回数がこの回数になるとブラックリストに自動登録される（DBの auto_blacklist_payment_noshow と同じ） */
export const NOSHOW_BLACKLIST_COUNT = 3;
/** 来なかった回数がこの回数になるとイエローリスト */
export const NOSHOW_YELLOW_COUNT = 2;

/** 支払いに来なかったときのルール（予約画面・チケット画面で共通に使う） */
export const NOSHOW_RULE_TEXT = `時間内に支払いがない場合、予約は自動でキャンセルされ、「支払いに来なかった回数」に数えられます。${NOSHOW_YELLOW_COUNT}回で警告、${NOSHOW_BLACKLIST_COUNT}回で予約サイトを利用できなくなります。`;

/**
 * ログイン中の本人の利用状態を読む。読めなかったときは null。
 * get_my_access_status が未反映の環境では、旧RPC get_my_noshow_status（理由なし）で代用する。
 */
export async function fetchMyAccessStatus(): Promise<AccessStatus | null> {
  const { data, error } = await supabase.rpc('get_my_access_status');
  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as AccessStatus | undefined;
    return row ?? null;
  }

  const fallback = await supabase.rpc('get_my_noshow_status');
  if (fallback.error) return null;
  const row = (Array.isArray(fallback.data) ? fallback.data[0] : fallback.data) as
    | { noshow_count: number; level: AccessStatus['level'] }
    | undefined;
  if (!row) return null;
  return { noshow_count: row.noshow_count, level: row.level, blacklist_reason: null, blacklist_expires_at: null };
}
