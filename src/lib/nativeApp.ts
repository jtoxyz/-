// スマホアプリ（がっけんぽアプリ。osu-gakkenpo/shic-portal の mobile/）の中で開かれているときの処理。
// アプリは User-Agent の末尾に「GakkenpoApp/1」を付けている。ブラウザで開いたときは何もしない。

export const APP_SCHEME = 'jp.gakkenpo.app';

export function isNativeApp(): boolean {
  return typeof navigator !== 'undefined' && /GakkenpoApp\//.test(navigator.userAgent || '');
}

export function nativePlatform(): 'ios' | 'android' {
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) ? 'ios' : 'android';
}

/** がっけんぽ.jp 全体の Cookie に入っている、この端末の通知の番号（アプリが がっけんぽ.jp を開いたときに入れる） */
export function appDeviceToken(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|;\s*)gakkenpo_app_device=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** ブラウザでのログインが終わったあと、アプリに戻ってこのアドレスを開かせるためのアドレス */
export function appOpenUrl(httpsUrl: string): string {
  return `${APP_SCHEME}://open?u=${encodeURIComponent(httpsUrl)}`;
}
