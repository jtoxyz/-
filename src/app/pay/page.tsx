'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheckBig } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { STUDENT_EMAIL_DOMAIN, isStudentEmail } from '@/lib/config';

const CLAIM_KEY_PREFIX = 'payment-claim-key:';

function randomKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

const CLAIM_KEY_PARAM = 'k';

function isClaimKey(value: string | null): value is string {
  return !!value && value.length >= 16 && value.length <= 128;
}

/** このQRを読み取った端末の鍵。同じQRをほかの人が開いても鍵が違うので、確定できるのは最初に読み取った端末だけになる。
 *  Googleログインから戻ってきても同じ鍵を使えるよう、ログインの戻り先URL（k=）に付けて持ち回る。
 *  localStorage だけに置くと、戻ってきたときに読めない端末があり、本人なのに「ほかの人が先に読み取りました」になっていた（2026-11-16）。
 *  QRコード自体には鍵は入らないので、同じQRを読み取った別の人が鍵を知ることはない。 */
function claimKeyFor(token: string, keyFromUrl: string | null): string {
  const storageKey = `${CLAIM_KEY_PREFIX}${token}`;
  let key: string | null = isClaimKey(keyFromUrl) ? keyFromUrl : null;
  if (!key) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (isClaimKey(saved)) key = saved;
    } catch {}
  }
  if (!key) key = randomKey();
  try {
    localStorage.setItem(storageKey, key);
  } catch {}
  return key;
}

function forgetClaimKey(token: string) {
  try {
    localStorage.removeItem(`${CLAIM_KEY_PREFIX}${token}`);
  } catch {}
}

type RedeemResult = {
  event_id: string;
  event_title: string;
  paid_reservations: number;
  qr_mode: 'daily' | 'dynamic';
};

export default function PaymentQrRedeemPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('支払い確認を準備しています…');
  const [success, setSuccess] = useState(false);
  const [paidCount, setPaidCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const redeem = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token') || '';
      if (!token) {
        setMessage('委員会で表示されるQRコードを読み取ると、支払い確認ができます。支払い状況は「マイチケット」で確認できます。');
        setLoading(false);
        return;
      }

      // 読み取った時点で QR を「読み取り済み」にし、受付の画面を次の QR に切り替える（ログイン前でも行う）。
      // 同時にほかの人が読み取っていたら、ここでエラーになる（ログインする前に分かる）
      const claimKey = claimKeyFor(token, params.get(CLAIM_KEY_PARAM));
      const { error: claimError } = await supabase.rpc('claim_payment_qr', { p_token: token, p_claim_key: claimKey });
      if (!mounted) return;
      if (claimError) {
        setMessage(claimError.message || 'このQRコードは使用できません。');
        setLoading(false);
        return;
      }

      const startLogin = async () => {
        setMessage('QRコードを読み取りました。大学Googleアカウントでログインすると支払い確認が完了します（10分以内）。');
        const redirectTo = `${window.location.origin}/pay?token=${encodeURIComponent(token)}&${CLAIM_KEY_PARAM}=${encodeURIComponent(claimKey)}`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: { hd: STUDENT_EMAIL_DOMAIN, prompt: 'select_account' },
          },
        });
        if (mounted && error) {
          setMessage(`大学Googleログインを開始できませんでした: ${error.message}`);
          setLoading(false);
        }
      };

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        await startLogin();
        return;
      }

      if (!isStudentEmail(session.user.email)) {
        await supabase.auth.signOut({ scope: 'local' });
        if (mounted) await startLogin();
        return;
      }

      const { data, error } = await supabase.rpc('redeem_payment_qr', { p_token: token, p_claim_key: claimKey });
      if (!mounted) return;

      if (error) {
        setMessage(error.message || '支払い確認に失敗しました。');
        setLoading(false);
        return;
      }

      const result = (Array.isArray(data) ? data[0] : data) as RedeemResult | undefined;
      if (!result) {
        setMessage('支払い確認結果を取得できませんでした。');
        setLoading(false);
        return;
      }

      forgetClaimKey(token);
      setSuccess(true);
      setPaidCount(Number(result.paid_reservations) || 0);
      setMessage(`「${result.event_title}」の支払い確認が完了しました。`);
      // 開き直しや再読み込みで同じ QR をもう一度使おうとしないよう、URL からトークンを外す
      window.history.replaceState(null, '', '/pay');
      setLoading(false);
    };

    void redeem();
    return () => { mounted = false; };
  }, []);

  return (
    <div style={{ maxWidth: 620, margin: '0 auto', paddingTop: 24 }}>
      <div className="glass-card" style={{ textAlign: 'center' }} aria-live="polite">
        {success && <CircleCheckBig size={56} aria-hidden="true" style={{ color: 'var(--color-success)', marginBottom: 8 }} />}
        <h1 style={{ marginTop: 0 }}>{success ? '支払い確認完了' : '支払い確認'}</h1>
        {loading && <div className="loading-spinner" style={{ margin: '24px auto' }} />}
        <p style={{ lineHeight: 1.8, fontSize: '1.05rem' }}>{message}</p>
        {success && (
          <>
            <p style={{ fontSize: '1.4rem', fontWeight: 800, margin: '12px 0' }}>{paidCount}件の予約を支払い済みにしました</p>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.9rem' }}>
              この画面を受付の係に見せてください。件数が支払った枚数と合っているか確認してもらえます。
            </p>
            <Link href="/#my-tickets" className="btn btn-primary" style={{ marginTop: 16 }}>自分の予約を見る</Link>
          </>
        )}
        {!loading && !success && (
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            QRコードは一回限りです。うまくいかない場合は、画面に表示されている新しいQRコードを読み取ってください。
          </p>
        )}
      </div>
    </div>
  );
}
