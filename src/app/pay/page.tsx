'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const UNIVERSITY_DOMAIN = 'ge.osaka-sandai.ac.jp';

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

  useEffect(() => {
    let mounted = true;

    const redeem = async () => {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      if (!token) {
        setMessage('QRコードの情報が不足しています。もう一度QRコードを読み取ってください。');
        setLoading(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        const redirectTo = `${window.location.origin}/pay?token=${encodeURIComponent(token)}`;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: { hd: UNIVERSITY_DOMAIN, prompt: 'select_account' },
          },
        });
        if (mounted && error) {
          setMessage(`大学Googleログインを開始できませんでした: ${error.message}`);
          setLoading(false);
        }
        return;
      }

      const email = String(session.user.email || '').toLowerCase();
      if (!email.endsWith(`@${UNIVERSITY_DOMAIN}`)) {
        await supabase.auth.signOut();
        if (mounted) {
          setMessage('大学Googleアカウントでログインしてください。');
          setLoading(false);
        }
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
      setMessage(`「${result.event_title}」の支払い確認が完了しました。`);
      setLoading(false);
    };

    void redeem();
    return () => { mounted = false; };
  }, []);

  return (
    <main style={{ maxWidth: 620, margin: '0 auto', padding: '48px 20px' }}>
      <div className="glass-card" style={{ textAlign: 'center' }}>
        <h1 style={{ marginTop: 0 }}>{success ? '支払い確認完了' : '支払い確認'}</h1>
        {loading && <div className="loading-spinner" style={{ margin: '24px auto' }} />}
        <p style={{ lineHeight: 1.8, fontSize: '1.05rem' }}>{message}</p>
        {!loading && !success && (
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            動的QRは一回限りです。別の人が先に使用した場合は、表示されている新しいQRを読み直してください。
          </p>
        )}
      </div>
    </main>
  );
}
