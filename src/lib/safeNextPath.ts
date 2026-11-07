/**
 * ログイン後の戻り先（?next=）を、このサイトの中のパスだけに限る。
 * 「/\example.com」のようにブラウザが別サイトとして解釈する値は「/」に置き換える。
 */
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  // バックスラッシュや制御文字は、URLとして解釈されると別ホストになることがある
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  if (typeof window === 'undefined') return value;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}
