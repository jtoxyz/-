/**
 * 受付の支払いQR（https://…/pay?token=…）から token を取り出す。
 * このサイトの /pay を指すQRだけを受け付け、それ以外（別サイトのURL・ただの文字）は null。
 */
export function paymentTokenFromQr(text: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(text.trim(), origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname.replace(/\/+$/, '') !== '/pay') return null;
  const token = url.searchParams.get('token');
  if (!token || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}
