'use client';

export const runtime = 'edge';

import { useEffect, useMemo, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';

type EventItem = { id: string; title: string; payment_required: boolean | null };
type CurrentQr = { qr_id: string; qr_token: string; created_at: string };

export default function AdminPaymentQrPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [current, setCurrent] = useState<CurrentQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paymentUrl = useMemo(() => {
    if (!current || typeof window === 'undefined') return '';
    return `${window.location.origin}/pay/${current.qr_token}`;
  }, [current]);

  const loadEvents = async () => {
    const { data, error: fetchError } = await supabase
      .from('events')
      .select('id,title,payment_required')
      .eq('payment_required', true)
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    const rows = (data as EventItem[]) || [];
    setEvents(rows);
    setEventId((currentId) => currentId || rows[0]?.id || '');
    setLoading(false);
  };

  const loadCurrent = async (targetEventId: string) => {
    if (!targetEventId) {
      setCurrent(null);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc('admin_get_current_dynamic_payment_qr', {
      p_event_id: targetEventId,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const row = Array.isArray(data) ? data[0] : data;
    setCurrent((row as CurrentQr | undefined) || null);
  };

  useEffect(() => {
    if (!authLoading && user) void loadEvents();
  }, [authLoading, user]);

  useEffect(() => {
    if (!eventId) return;
    void loadCurrent(eventId);
    const timer = window.setInterval(() => void loadCurrent(eventId), 500);
    return () => window.clearInterval(timer);
  }, [eventId]);

  const createDynamic = async () => {
    if (!eventId) return;
    setCreating(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_create_payment_qr', {
      p_event_id: eventId,
      p_mode: 'dynamic',
      p_valid_date: null,
      p_dynamic_seconds: 90,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      if (row) setCurrent({ qr_id: row.qr_id, qr_token: row.qr_token, created_at: row.valid_from });
    }
    setCreating(false);
  };

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><div className="loading-spinner" /></div>;
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <main>
          <div className="glass-card">
            <h1 style={{ marginTop: 0 }}>動的支払いQR</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              QRは一回限りです。1人の支払い確認が成功した瞬間に無効化され、次のQRが自動発行されます。この画面は0.5秒ごとに最新QRへ切り替わります。
            </p>

            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group" style={{ maxWidth: 520 }}>
              <label className="form-label">企画</label>
              <select className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
              </select>
            </div>

            {!current ? (
              <button className="btn btn-primary" onClick={createDynamic} disabled={creating || !eventId}>
                {creating ? '発行中…' : '最初の動的QRを発行'}
              </button>
            ) : (
              <div className="glass-card" style={{ marginTop: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 }}>現在有効な一回限りQRのURL</div>
                <div style={{ wordBreak: 'break-all', fontWeight: 700, lineHeight: 1.6 }}>{paymentUrl}</div>
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
                  発行日時: {new Date(current.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                </div>
                <button className="btn btn-secondary" style={{ marginTop: 16 }} onClick={() => navigator.clipboard.writeText(paymentUrl)}>
                  URLをコピー
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
