'use client';

import { useSyncExternalStore } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { MonitorX } from 'lucide-react';

const noopSubscribe = () => () => {};

/** PCで開いたときにチケットの代わりに出す案内。スマホで同じ画面を開くQRを付ける */
export default function PcBlockedTicket({ what = 'チケット' }: { what?: string }) {
  const url = useSyncExternalStore(noopSubscribe, () => window.location.href, () => '');

  return (
    <div className="glass-card" role="alert" style={{ textAlign: 'center', padding: '22px 18px', border: '2px solid var(--color-warning-border)' }}>
      <MonitorX size={36} aria-hidden="true" style={{ color: 'var(--color-warning)' }} />
      <h2 style={{ fontSize: '1.15rem', margin: '8px 0 6px' }}>{what}はスマホでのみ表示できます</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.7, margin: 0 }}>
        受付・受取はスマホのみです。PCを受付に持ってこないでください。
        <br />スマホでこのQRコードを読み取ると、同じ画面が開きます（大学Googleアカウントでログインしてください）。
      </p>
      {url && (
        <div style={{ display: 'inline-block', marginTop: 14, padding: 10, background: '#fff', borderRadius: 10 }}>
          <QRCodeSVG value={url} size={168} />
        </div>
      )}
    </div>
  );
}
