'use client';

import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { adminSupabase as supabase } from '@/lib/supabase';

type EventItem = { id: string; title: string; payment_required: boolean | null };
type CurrentQr = { qr_id: string; qr_token: string; created_at: string };

const LANE_STORAGE_KEY = 'payment-qr-lane';

/** この端末専用の QR を出すための端末ID。端末（ブラウザ）ごとに一度だけ作って保存する。 */
function getDeviceLane(): string {
  try {
    const saved = localStorage.getItem(LANE_STORAGE_KEY);
    if (saved && saved.length >= 8) return saved;
  } catch {}
  const lane = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  try {
    localStorage.setItem(LANE_STORAGE_KEY, lane);
  } catch {}
  return lane;
}

export default function AdminPaymentQrPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [current, setCurrent] = useState<CurrentQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 端末IDはブラウザでしか作れない。最初の描画は読み込み中表示なので、サーバー側では空のままでよい
  const [lane] = useState(() => (typeof window === 'undefined' ? '' : getDeviceLane()));

  const paymentUrl = useMemo(() => {
    if (!current || typeof window === 'undefined') return '';
    return `${window.location.origin}/pay?token=${encodeURIComponent(current.qr_token)}`;
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

  // この端末専用の QR を取得する（未読み取りの QR がなければ DB 側で発行される）
  const loadCurrent = async (targetEventId: string, deviceLane: string) => {
    if (!targetEventId || !deviceLane) {
      setCurrent(null);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc('admin_get_lane_payment_qr', {
      p_event_id: targetEventId,
      p_lane: deviceLane,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setError(null);
    const row = Array.isArray(data) ? data[0] : data;
    setCurrent((row as CurrentQr | undefined) || null);
  };

  useEffect(() => {
    if (!authLoading && user) void loadEvents();
  }, [authLoading, user]);

  useEffect(() => {
    if (!eventId || !lane) return;
    void loadCurrent(eventId, lane);
    const timer = window.setInterval(() => void loadCurrent(eventId, lane), 500);
    return () => window.clearInterval(timer);
  }, [eventId, lane]);

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
              この端末専用のQRです。複数のスマホで開くと、スマホごとに別々のQRが表示されるので、何台でも同時に受け付けられます。
              QRは一回限りで、学生が読み取った瞬間（ログイン前）にこの端末だけ次のQRへ切り替わります。読み取った人は10分以内にログインすれば支払いが確定します。
            </p>

            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group" style={{ maxWidth: 520 }}>
              <label className="form-label">企画</label>
              <select className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
              </select>
            </div>

            {!current ? (
              <div style={{ textAlign: 'center', padding: 24 }}><div className="loading-spinner" /></div>
            ) : (
              <div className="glass-card" style={{ marginTop: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>この端末専用の一回限りQR（端末ID: {lane.slice(0, 4).toUpperCase()}）</div>
                {paymentUrl && (
                  <div className="qr-frame">
                    <QRCodeSVG value={paymentUrl} size={320} level="M" includeMargin />
                  </div>
                )}
                <div style={{ marginTop: 14, wordBreak: 'break-all', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{paymentUrl}</div>
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
