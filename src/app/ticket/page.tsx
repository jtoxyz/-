'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function LegacyTicketPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const publicToken = new URLSearchParams(window.location.search).get('token');

    if (!publicToken) {
      setError('チケットが指定されていません。');
      return () => {
        active = false;
      };
    }

    const resolveTicket = async () => {
      const { data, error: rpcError } = await supabase.rpc('get_my_reservation_id_by_token', {
        p_public_token: publicToken,
      });

      if (!active) return;
      if (rpcError || !data) {
        setError(rpcError?.message || 'このGoogleアカウントに紐づくチケットが見つかりません。');
        return;
      }

      router.replace(`/my-tickets?reservationId=${encodeURIComponent(String(data))}`);
    };

    void resolveTicket();
    return () => {
      active = false;
    };
  }, [router]);

  if (error) {
    return (
      <div className="glass-card text-center" style={{ maxWidth: 560, margin: '32px auto', padding: 34 }}>
        <div className="error-banner">{error}</div>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 16 }}>
          予約時と同じ大学Googleアカウントでログインしているか確認してください。
        </p>
        <Link href="/#my-tickets"><button className="btn btn-secondary" style={{ marginTop: 16 }}>自分の予約へ戻る</button></Link>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: 64 }}>
      <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
      <p style={{ color: 'var(--text-secondary)' }}>本人のチケット画面を開いています...</p>
    </div>
  );
}
