'use client';

import { useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Download, Printer, RefreshCw, TriangleAlert } from 'lucide-react';
import { downloadPng, downloadSvg, safeFileName } from '@/lib/qrDownload';
import { todayJst } from '@/lib/jst';

export type DailyQr = { qr_id: string; qr_token: string; valid_from?: string; valid_until?: string; redemption_count?: number };
type QrResult = { data: unknown; error: { message: string } | null };

/**
 * 1日支払いQR（指定した日の0:00〜翌0:00に何度でも使える固定QR）。
 * - 管理者（mode="admin"）：発行するたびに新しいQRになり、同じ日の古いQRは無効になる。
 * - スタッフ（mode="staff"）：その日のQRがあればそれを表示する。作り直しは確認してから行う。
 */
export default function DailyPaymentQr({
  eventId,
  eventTitle,
  mode,
  issue,
}: {
  eventId: string;
  eventTitle: string;
  mode: 'admin' | 'staff';
  issue: (eventId: string, validDate: string, reissue: boolean) => PromiseLike<QrResult>;
}) {
  const [validDate, setValidDate] = useState(todayJst);
  const [qr, setQr] = useState<{ key: string; value: DailyQr } | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  // 企画や日付を変えたら、前に表示していたQRは隠す
  const key = `${eventId}:${validDate}`;
  const shown = qr?.key === key ? qr.value : null;
  const paymentUrl = shown && typeof window !== 'undefined'
    ? `${window.location.origin}/pay?token=${encodeURIComponent(shown.qr_token)}`
    : '';

  const run = async (reissue: boolean) => {
    if (!eventId || !validDate) return;
    if (reissue && !confirm('この日のQRを作り直します。前のQR（印刷・共有したものを含む）は使えなくなります。よろしいですか？')) return;
    setWorking(true);
    setError(null);
    const { data, error: rpcError } = await issue(eventId, validDate, reissue);
    if (rpcError) setError(rpcError.message);
    else {
      const row = (Array.isArray(data) ? data[0] : data) as DailyQr | undefined;
      setQr(row ? { key, value: row } : null);
    }
    setWorking(false);
  };

  const fileBase = safeFileName(`${eventTitle || 'payment'}-${validDate}-qr`);
  const svg = () => qrRef.current?.querySelector('svg');

  return (
    <div>
      {error && (
        <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>
          <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <div className="form-group" style={{ maxWidth: 280 }}>
        <label className="form-label" htmlFor={`daily-date-${mode}`}>使用日</label>
        <input id={`daily-date-${mode}`} className="form-input" type="date" value={validDate} min={todayJst()} onChange={(e) => setValidDate(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {mode === 'staff' ? (
          <>
            <button type="button" className="btn btn-primary" onClick={() => void run(false)} disabled={working || !eventId || !validDate}>
              {working ? '読み込み中…' : 'この日のQRを表示'}
            </button>
            {shown && (
              <button type="button" className="btn btn-secondary" onClick={() => void run(true)} disabled={working}>
                <RefreshCw size={16} aria-hidden="true" />QRを作り直す
              </button>
            )}
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => void run(false)} disabled={working || !eventId || !validDate}>
            {working ? '発行中…' : 'この日のQRを発行（前のQRは無効になります）'}
          </button>
        )}
      </div>

      <p style={{ marginTop: 12, fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        1日QRはその日のうちは何度でも使えます。写真で出回ると支払わずに支払い済みにできてしまうので、
        受付の机から持ち出さず、出回ったときは作り直してください。混雑しない日は「動的支払いQR」のほうが安全です。
      </p>

      {shown && paymentUrl && (
        <section className="glass-card payment-qr-print-area" style={{ marginTop: 24, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>{eventTitle || '支払い確認'}</h2>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{validDate} 専用</div>
          <div ref={qrRef} className="qr-frame">
            <QRCodeSVG value={paymentUrl} size={360} level="M" includeMargin />
          </div>
          <p style={{ marginTop: 16, lineHeight: 1.7 }}>
            支払い後、大学GoogleアカウントでこのQRを読み取ってください。
          </p>
          {typeof shown.redemption_count === 'number' && (
            <p className="payment-qr-print-actions" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>このQRで支払い済みにした回数：{shown.redemption_count}回</p>
          )}
          <div className="payment-qr-print-actions" style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(paymentUrl)}><Copy size={15} aria-hidden="true" />URLをコピー</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => downloadPng(svg(), 1024, `${fileBase}.png`)}><Download size={15} aria-hidden="true" />PNGで保存</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadSvg(svg(), `${fileBase}.svg`)}><Download size={15} aria-hidden="true" />SVGで保存</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}><Printer size={15} aria-hidden="true" />印刷する</button>
          </div>
        </section>
      )}
    </div>
  );
}
