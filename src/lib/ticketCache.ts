/**
 * [重要度: 高]
 * 利用者が取得済みの予約券・当日券を再表示できるよう、公開トークンを端末内へ保存する補助処理。
 * これは表示上の利便性のためのキャッシュであり、予約の成立判定や本人確認そのものには使用しないこと。
 * localStorageまたはCookieを削除しても予約データ自体はSupabaseに残る。
 */

const CACHE_KEY = 'saved_event_tickets';

// [重要度: 中]
// 指定した名前のCookieを取得する。サーバー側ではdocumentが存在しないためnullを返す。
function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) {
    return parts.pop()?.split(';').shift() || null;
  }
  return null;
}

// [重要度: 中]
// 公開トークン一覧をCookieへ保存する。SameSite=Laxにより通常の外部サイト経由の送信を抑える。
// 保存期間やpathを変更すると、過去のチケットを再表示できる期間・範囲に影響する。
function setCookie(name: string, value: string, days = 365) {
  if (typeof document === 'undefined') return;
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `; expires=${date.toUTCString()}`;
  document.cookie = `${name}=${encodeURIComponent(value)}${expires}; path=/; SameSite=Lax`;
}

// [重要度: 高]
// 保存済み公開トークンをlocalStorageから読み、取得できない場合だけCookieを予備として使用する。
// 壊れたJSONや想定外の値が入っていても画面全体を停止させないよう、例外時は空配列として扱う。
export function getSavedTokens(): string[] {
  if (typeof window === 'undefined') return [];

  let tokens: string[] = [];

  // [重要度: 中]
  // 通常は容量が大きく扱いやすいlocalStorageを優先して読み込む。
  try {
    const localData = localStorage.getItem(CACHE_KEY);
    if (localData) {
      tokens = JSON.parse(localData);
    }
  } catch (e) {
    console.error('Error reading localStorage ticket cache:', e);
  }

  // [重要度: 中]
  // localStorageにデータがない場合、Cookieに残っているトークンを復元する。
  if (tokens.length === 0) {
    try {
      const cookieData = getCookie(CACHE_KEY);
      if (cookieData) {
        tokens = JSON.parse(decodeURIComponent(cookieData));
      }
    } catch (e) {
      console.error('Error reading cookie ticket cache:', e);
    }
  }

  // [重要度: 高]
  // 不正な型・空文字・重複トークンを除去し、後続のチケット取得処理へ安全な配列だけを渡す。
  if (!Array.isArray(tokens)) {
    return [];
  }
  return Array.from(new Set(tokens.filter((t) => typeof t === 'string' && t.trim() !== '')));
}

// [重要度: 高]
// 予約または当日券の発行成功後に公開トークンを端末へ保存する。
// 同じトークンを重複保存しないことで、チケット一覧の重複表示を防いでいる。
export function saveToken(token: string) {
  if (typeof window === 'undefined' || !token) return;

  const tokens = getSavedTokens();
  if (!tokens.includes(token)) {
    tokens.push(token);
    
    // [重要度: 中]
    // 主保存先としてlocalStorageを更新する。失敗してもCookie保存は続行する。
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(tokens));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }

    // [重要度: 中]
    // localStorageが利用できない環境に備え、同じ内容をCookieにも保存する。
    try {
      setCookie(CACHE_KEY, JSON.stringify(tokens));
    } catch (e) {
      console.error('Failed to save to cookie:', e);
    }
  }
}

// [重要度: 高]
// 端末の一覧から指定トークンだけを削除する。
// Supabase上の予約・当日券データをキャンセルまたは削除する処理ではない点に注意すること。
export function removeToken(token: string) {
  if (typeof window === 'undefined') return;

  let tokens = getSavedTokens();
  tokens = tokens.filter((t) => t !== token);

  // [重要度: 中]
  // localStorage側の一覧を更新する。
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(tokens));
  } catch (e) {
    console.error('Failed to update localStorage cache:', e);
  }

  // [重要度: 中]
  // Cookie側も同じ内容へ更新し、保存先の不一致を防ぐ。
  try {
    setCookie(CACHE_KEY, JSON.stringify(tokens));
  } catch (e) {
    console.error('Failed to update cookie cache:', e);
  }
}
