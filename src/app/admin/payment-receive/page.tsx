'use client';

import { useState } from 'react';
import AdminNav from '@/components/AdminNav';
import PaymentReceiveDesk from '@/components/payment/PaymentReceiveDesk';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { adminSupabase } from '@/lib/supabase';

type EventRow = { id: string; title: string; payment_confirm_mode?: string | null };

export default function AdminPaymentReceivePage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useLoadEffect(async () => {
    if (authLoading || !user) return;
    const { data, error: fetchError } = await adminSupabase
      .from('events')
      .select('*')
      .eq('payment_required', true)
      .order('created_at', { ascending: false });

    if (fetchError) setError(fetchError.message);
    else {
      // 列がまだ無い環境では undefined になり、1件も出ない
      const rows = ((data as EventRow[]) || []).filter((e) => e.payment_confirm_mode === 'staff');
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
            <h1 style={{ marginTop: 0 }}>支払い受付（係）</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              学生が見せる受付QRを読み取って、支払いを受領します。
            </p>

            {error && <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

            {events.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>
                受付の係が確認する企画はありません。企画の編集で『受付の係が確認する』を選んでください
              </p>
            ) : (
              <>
                <div className="form-group" style={{ maxWidth: 520 }}>
                  <label className="form-label" htmlFor="payment-receive-event">企画</label>
                  <select id="payment-receive-event" className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                    {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                  </select>
                </div>
                {eventId && <PaymentReceiveDesk key={eventId} client={adminSupabase} eventId={eventId} isAdmin />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
