'use client';

import { useState } from 'react';
import AdminNav from '@/components/AdminNav';
import DailyPaymentQr from '@/components/payment/DailyPaymentQr';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { adminSupabase as supabase } from '@/lib/supabase';
import { adminIssueDailyQr } from '@/lib/paymentQrRpc';

type EventItem = { id: string; title: string };

const issueDailyQr = adminIssueDailyQr(supabase);

export default function AdminDailyPaymentQrPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLoadEffect(async () => {
    if (authLoading || !user) return;
    const { data, error: fetchError } = await supabase
      .from('events')
      .select('id,title')
      .eq('payment_required', true)
      .order('created_at', { ascending: false });

    if (fetchError) setError(fetchError.message);
    else {
      const rows = (data as EventItem[]) || [];
      setEvents(rows);
      setEventId(rows[0]?.id || '');
    }
    setLoading(false);
  }, [authLoading, user]);

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><div className="loading-spinner" /></div>;
  }

  const selectedEvent = events.find((event) => event.id === eventId);

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div>
          <div className="glass-card">
            <h1 style={{ marginTop: 0 }}>1日支払いQR</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              指定した日の0:00から翌日0:00まで有効な固定QRを発行します。同じ企画・同じ日で再発行すると、古いQRは無効になります。
            </p>

            {error && <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            {events.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>支払いが必要な企画がありません。</p>
            ) : (
              <>
                <div className="form-group" style={{ maxWidth: 520 }}>
                  <label className="form-label" htmlFor="daily-qr-event">企画</label>
                  <select id="daily-qr-event" className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                  </select>
                </div>
                <DailyPaymentQr eventId={eventId} eventTitle={selectedEvent?.title || ''} mode="admin" issue={issueDailyQr} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
