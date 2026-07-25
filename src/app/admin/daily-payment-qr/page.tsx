'use client';

export const runtime = 'edge';

import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';

type EventItem = { id: string; title: string; payment_required: boolean | null };
type DailyQr = {
  qr_id: string;
  qr_token: string;
  qr_mode: 'daily';
  valid_from: string;
  valid_until: string;
};

function todayInJapan(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function AdminDailyPaymentQrPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [validDate, setValidDate] = useState(todayInJapan());
  const [issuedQr, setIssuedQr] = useState<DailyQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  const selectedEvent = events.find((event) => event.id === eventId);
  const paymentUrl = useMemo(() => {
    if (!issuedQr || typeof window === 'undefined') return '';
    return `${window.location.origin}/pay/${issuedQr.qr_token}`;
  }, [issuedQr]);

  useEffect(() => {
    if (authLoading || !user) return;

    const loadEvents = async () => {
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('id,title,payment_required')
        .eq('payment_required', true)
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message);
      } else {
        const rows = (data as EventItem[]) || [];
        setEvents(rows);
        setEventId(rows[0]?.id || '');
      }
      setLoading(false);
    };

    void loadEvents();
  }, [authLoading, user]);

  useEffect(() => {
    setIssuedQr(null);
  }, [eventId, validDate]);

  const createDaily = async () => {
    if (!eventId || !validDate) return;
    setCreating(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('admin_create_payment_qr', {
      p_event_id: eventId,
      p_mode: 'daily',
      p_valid_date: validDate,
      p_dynamic_seconds: 90,
    });

    if (rpcError) {
      setError(rpcError.message);
    } else {
      const row = Array.isArray(data) ? data[0] : data;
      setIssuedQr((row as DailyQr | undefined) || null);
    }
    setCreating(false);
  };

  const printQr = () => window.print();

  const downloadSvg = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedEvent?.title || 'payment'}-${validDate}-qr.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadPng = () => {
    const svg = qrRef.current?.querySelector('svg');
    if (!svg) return;
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 1024, 1024);
      context.drawImage(image, 0, 0, 1024, 1024);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${selectedEvent?.title || 'payment'}-${validDate}-qr.png`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
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
            <h1 style={{ marginTop: 0 }}>1日支払いQR</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              指定した日の0:00から翌日0:00まで有効な固定QRを発行します。同じ企画・同じ日で再発行すると、古いQRは無効になります。
            </p>

            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16, maxWidth: 720 }}>
              <div className="form-group">
                <label className="form-label">企画</label>
                <select className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">使用日</label>
                <input className="form-input" type="date" value={validDate} onChange={(e) => setValidDate(e.target.value)} />
              </div>
            </div>

            <button className="btn btn-primary" onClick={createDaily} disabled={creating || !eventId || !validDate}>
              {creating ? '発行中…' : 'この日のQRを発行'}
            </button>

            {issuedQr && paymentUrl && (
              <section className="glass-card payment-qr-print-area" style={{ marginTop: 24, textAlign: 'center' }}>
                <h2 style={{ marginTop: 0 }}>{selectedEvent?.title || '支払い確認'}</h2>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{validDate} 専用</div>
                <div ref={qrRef} style={{ display: 'inline-flex', padding: 20, background: '#fff', borderRadius: 16 }}>
                  <QRCodeSVG value={paymentUrl} size={360} level="M" includeMargin />
                </div>
                <p style={{ marginTop: 16, lineHeight: 1.7 }}>
                  支払い後、大学GoogleアカウントでこのQRを読み取ってください。
                </p>
                <div style={{ wordBreak: 'break-all', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{paymentUrl}</div>
                <div className="payment-qr-print-actions" style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginTop: 18 }}>
                  <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText(paymentUrl)}>URLをコピー</button>
                  <button className="btn btn-primary" onClick={downloadPng}>PNGで保存</button>
                  <button className="btn btn-secondary" onClick={downloadSvg}>SVGで保存</button>
                  <button className="btn btn-secondary" onClick={printQr}>印刷する</button>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      <style jsx global>{`
        @media print {
          body * { visibility: hidden !important; }
          .payment-qr-print-area, .payment-qr-print-area * { visibility: visible !important; }
          .payment-qr-print-area {
            position: fixed !important;
            inset: 0 !important;
            margin: 0 !important;
            border: 0 !important;
            box-shadow: none !important;
            background: #fff !important;
            color: #000 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
          }
          .payment-qr-print-actions { display: none !important; }
        }
      `}</style>
    </div>
  );
}
