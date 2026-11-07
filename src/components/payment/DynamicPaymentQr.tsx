'use client';

import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, TriangleAlert } from 'lucide-react';
import { formatJstDateTime } from '@/lib/jst';

type CurrentQr = { qr_id: string; qr_token: string; created_at: string };
type QrResult = { data: unknown; error: { message: string } | null };

const LANE_STORAGE_KEY = 'payment-qr-lane';
// 読み取られたら次のQRに切り替える。1秒ごとに確認し、前の確認が終わるまで次は送らない
const POLL_INTERVAL_MS = 1000;

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

/**
 * 端末ごとの一回限りの支払いQR。学生が読み取った瞬間に、この端末だけ次のQRへ切り替わる。
 * fetchQr は管理者用（admin_get_lane_payment_qr）とスタッフ用（staff_get_lane_payment_qr）を渡し分ける。
 */
export default function DynamicPaymentQr({
  eventId,
  fetchQr,
}: {
  eventId: string;
  fetchQr: (eventId: string, lane: string) => PromiseLike<QrResult>;
}) {
  const [current, setCurrent] = useState<CurrentQr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // 端末IDはブラウザでしか作れない。最初の描画は読み込み中表示なので、サーバー側では空のままでよい
  const [lane] = useState(() => (typeof window === 'undefined' ? '' : getDeviceLane()));

  useEffect(() => {
    if (!eventId || !lane) return;
    let active = true;
    let inFlight = false;

    const poll = async () => {
      // 画面が裏にあるとき（別のアプリを開いている等）は問い合わせない
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      try {
        const { data, error: rpcError } = await fetchQr(eventId, lane);
        if (!active) return;
        if (rpcError) {
          setError(rpcError.message);
          return;
        }
        setError(null);
        const row = (Array.isArray(data) ? data[0] : data) as CurrentQr | undefined;
        setCurrent((prev) => (prev?.qr_id === row?.qr_id ? prev : row || null));
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [eventId, lane, fetchQr]);

  const paymentUrl = useMemo(() => {
    if (!current || typeof window === 'undefined') return '';
    return `${window.location.origin}/pay?token=${encodeURIComponent(current.qr_token)}`;
  }, [current]);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(paymentUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('URLをコピーできませんでした。');
    }
  };

  return (
    <div>
      {error && (
        <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>
          <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {!current ? (
        <div style={{ textAlign: 'center', padding: 24 }} role="status"><div className="loading-spinner" /></div>
      ) : (
        <div className="glass-card" style={{ marginTop: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
            この端末専用の一回限りQR（端末ID: {lane.slice(0, 4).toUpperCase()}）
          </div>
          {paymentUrl && (
            <div className="qr-frame">
              <QRCodeSVG value={paymentUrl} size={320} level="M" includeMargin />
            </div>
          )}
          <p style={{ marginTop: 14, lineHeight: 1.7, fontWeight: 700 }}>
            支払いを受け取ったら、学生にこのQRを読み取ってもらってください。
          </p>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            発行日時: {formatJstDateTime(current.created_at)}
          </div>
          <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 16 }} onClick={copyUrl}>
            <Copy size={15} aria-hidden="true" />{copied ? 'コピーしました' : 'URLをコピー'}
          </button>
        </div>
      )}
    </div>
  );
}
