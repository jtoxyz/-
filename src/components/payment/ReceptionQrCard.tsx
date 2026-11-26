'use client';

import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Maximize2, X } from 'lucide-react';
import { useFullscreenOverlay } from '@/hooks/useFullscreenOverlay';
import { staffPaymentQrUrl } from '@/lib/staffPaymentScan';
import { formatYen } from '@/lib/ticketOption';

const noopSubscribe = () => () => {};

/** 「受付の係が確認する」企画で、学生が受付で見せるQR。係が読み取って支払いを受領する */
export default function ReceptionQrCard({
  eventTitle,
  publicToken,
  totalYen,
}: {
  eventTitle: string;
  publicToken: string;
  totalYen: number | null;
}) {
  // origin はブラウザでしか分からない。サーバー描画では空にして、ブラウザで描き直す（食い違いを避ける）
  const origin = useSyncExternalStore(noopSubscribe, () => window.location.origin, () => '');
  const url = origin ? staffPaymentQrUrl(origin, publicToken) : '';
  const [fullscreen, setFullscreen] = useState(false);

  useFullscreenOverlay(fullscreen, () => setFullscreen(false));

  return (
    <div className="glass-card" style={{ margin: 0, textAlign: 'center' }}>
      <h3 style={{ fontSize: '1.05rem', marginBottom: 4 }}>受付で見せるQR</h3>
      <div style={{ fontWeight: 700 }}>{eventTitle}</div>
      {totalYen != null && (
        <div style={{ marginTop: 4, fontWeight: 800, color: 'var(--color-warning)' }}>
          {formatYen(totalYen)} を受付で払ってください
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        {url ? (
          <button
            type="button"
            className="qr-frame qr-frame-button"
            onClick={() => setFullscreen(true)}
            aria-label="QRコードを全画面で表示"
          >
            <QRCodeSVG value={url} size={240} level="M" includeMargin />
          </button>
        ) : (
          <div style={{ padding: 24 }} role="status"><div className="loading-spinner" /></div>
        )}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Maximize2 size={13} aria-hidden="true" />タップすると大きく表示します
      </div>

      {fullscreen && url && typeof document !== 'undefined' && createPortal(
        <div className="qr-fullscreen" role="dialog" aria-modal="true" aria-label="受付で見せるQR（全画面）">
          <button
            type="button"
            className="qr-fullscreen-close"
            onClick={() => setFullscreen(false)}
            aria-label="閉じる"
            autoFocus
          >
            <X size={28} aria-hidden="true" />
          </button>
          <div className="qr-fullscreen-body">
            <div className="qr-fullscreen-code">
              <QRCodeSVG value={url} size={1024} level="M" includeMargin />
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
