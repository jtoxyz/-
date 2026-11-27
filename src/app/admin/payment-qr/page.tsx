'use client';

import { useState } from 'react';
import AdminNav from '@/components/AdminNav';
import DynamicPaymentQr from '@/components/payment/DynamicPaymentQr';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { adminSupabase as supabase } from '@/lib/supabase';
import { adminLaneQr, reissueLaneQr } from '@/lib/paymentQrRpc';

type EventItem = { id: string; title: string };

type EventRow = EventItem & { payment_confirm_mode?: string | null };

const fetchLaneQr = adminLaneQr(supabase);
const reissueQr = reissueLaneQr(supabase);

export default function AdminPaymentQrPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [staffCount, setStaffCount] = useState(0);

  useLoadEffect(async () => {
    if (authLoading || !user) return;
    const { data, error: fetchError } = await supabase
      .from('events')
      .select('*')
      .eq('payment_required', true)
      .order('created_at', { ascending: false });

    if (fetchError) setError(fetchError.message);
    else {
      const all = (data as EventRow[]) || [];
      // 列がまだ無い環境では undefined になるので、学生が読む方式として扱う
      const rows = all.filter((e) => e.payment_confirm_mode !== 'staff');
      setStaffCount(all.length - rows.length);
      setEvents(rows);
      setEventId((currentId) => currentId || rows[0]?.id || '');
    }
    setLoading(false);
  }, [authLoading, user]);

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><div className="loading-spinner" /></div>;
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div>
          <div className="glass-card">
            <h1 style={{ marginTop: 0 }}>動的支払いQR</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              この端末専用のQRです。複数のスマホで開くと、スマホごとに別々のQRが表示されるので、何台でも同時に受け付けられます。
              QRは一回限りで、学生が読み取った瞬間（ログイン前）にこの端末だけ次のQRへ切り替わります。読み取った人は10分以内にログインすれば支払いが確定します。
              自治会などのスタッフには「スタッフ管理」で担当企画を割り当てると、管理画面に入らずにこのQRを出せます。
            </p>

            {error && <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}
            {staffCount > 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: 12 }}>
                受付の係が確認する企画（{staffCount}件）は「支払い受付（係）」で受け付けます。
              </p>
            )}

            {events.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>支払いが必要な企画がありません。</p>
            ) : (
              <>
                <div className="form-group" style={{ maxWidth: 520 }}>
                  <label className="form-label" htmlFor="payment-qr-event">企画</label>
                  <select id="payment-qr-event" className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                  </select>
                </div>
                <DynamicPaymentQr eventId={eventId} fetchQr={fetchLaneQr} reissueQr={reissueQr} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
