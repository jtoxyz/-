'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CircleCheckBig } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { STUDENT_EMAIL_DOMAIN, isStudentEmail } from '@/lib/config';

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
      const token = new URLSearchParams(window.location.search).get('token') || '';
      if (!token) {
        setMessage('委員会で表示されるQRコードを読み取ると、支払い確認ができます。支払い状況は「マイチケット」で確認できます。');
        setLoading(false);
        return;
      }

      // 読み取った時点で QR を「読み取り済み」にし、管理画面を次の QR に切り替える（ログイン前でも行う）
      const { error: claimError } = await supabase.rpc('claim_payment_qr', { p_token: token });
      if (!mounted) return;
      if (claimError) {
        setMessage(claimError.message || 'このQRコードは使用できません。');
        setLoading(false);
        return;
      }

      const startLogin = async () => {
        setMessage('QRコードを読み取りました。大学Googleアカウントでログインすると支払い確認が完了します（10分以内）。');
        const redirectTo = `${window.location.origin}/pay?token=${encodeURIComponent(token)}`;
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

      const { data, error } = await supabase.rpc('redeem_payment_qr', { p_token: token });
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
