'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Maximize2, RefreshCw, TriangleAlert, X } from 'lucide-react';
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
 * reissueQr は「新しいQRにする」ボタン用（staff_reissue_lane_payment_qr。管理者も使える）。
 */
export default function DynamicPaymentQr({
  eventId,
  fetchQr,
  reissueQr,
}: {
  eventId: string;
  fetchQr: (eventId: string, lane: string) => PromiseLike<QrResult>;
  /** この端末の表示中QRを無効にして新しいQRを出す */
  reissueQr: (eventId: string, lane: string) => PromiseLike<QrResult>;
}) {
  const [current, setCurrent] = useState<CurrentQr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reissuing, setReissuing] = useState(false);
  // QRをタップしたときの全画面表示
  const [fullscreen, setFullscreen] = useState(false);
  // 作り直しのたびに増やす。作り直し前に送った確認の結果（古いQR）で表示を戻さないようにする
  const generation = useRef(0);
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
      const startedAt = generation.current;
      try {
        const { data, error: rpcError } = await fetchQr(eventId, lane);
        if (!active || startedAt !== generation.current) return;
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

  const reissue = async () => {
    if (!eventId || !lane || reissuing) return;
    setReissuing(true);
    generation.current += 1;
    const { data, error: rpcError } = await reissueQr(eventId, lane);
    generation.current += 1;
    if (rpcError) setError(rpcError.message);
    else {
      setError(null);
      const row = (Array.isArray(data) ? data[0] : data) as CurrentQr | undefined;
      if (row) setCurrent(row);
    }
    setReissuing(false);
  };

  // 全画面表示中は、背景のスクロールを止め、画面が暗くならないようにし、可能ならブラウザも全画面にする
  useEffect(() => {
    if (!fullscreen) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const saved = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    // iOS Safari でも背景が動かないよう、body を固定してから元の位置に戻す
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overscrollBehavior = 'none';

    let wakeLock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const requestWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) void lock.release().catch(() => {});
        else wakeLock = lock;
      } catch {}
    };
    void requestWakeLock();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);

    // 対応しているブラウザ（Android Chrome など）ではアドレスバーも隠す。iPhoneでは使えないので無視する
    let enteredFullscreen = false;
    try {
      if (!document.fullscreenElement && html.requestFullscreen) {
        html.requestFullscreen({ navigationUI: 'hide' }).then(() => { enteredFullscreen = true; }).catch(() => {});
      }
    } catch {}
    const onFullscreenChange = () => {
      // 戻るジェスチャー等でブラウザの全画面が解除されたら、表示も閉じる
      if (enteredFullscreen && !document.fullscreenElement) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      html.style.overflow = saved.htmlOverflow;
      body.style.overflow = saved.bodyOverflow;
      body.style.position = saved.bodyPosition;
      body.style.top = saved.bodyTop;
      body.style.width = saved.bodyWidth;
      body.style.overscrollBehavior = saved.bodyOverscroll;
      window.scrollTo(0, scrollY);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKey);
      if (wakeLock) void wakeLock.release().catch(() => {});
      if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    };
  }, [fullscreen]);

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
            <button
              type="button"
              className="qr-frame qr-frame-button"
              onClick={() => setFullscreen(true)}
              aria-label="QRコードを全画面で表示"
            >
              <QRCodeSVG value={paymentUrl} size={320} level="M" includeMargin />
            </button>
          )}
          {paymentUrl && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Maximize2 size={13} aria-hidden="true" />QRをタップすると全画面で表示します
            </div>
          )}
          <p style={{ marginTop: 14, lineHeight: 1.7, fontWeight: 700 }}>
            支払いを受け取ったら、学生にこのQRを読み取ってもらってください。
          </p>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
            発行日時: {formatJstDateTime(current.created_at)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void reissue()} disabled={reissuing}>
              <RefreshCw size={15} aria-hidden="true" />{reissuing ? '作り直しています…' : '新しいQRにする'}
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copyUrl}>
              <Copy size={15} aria-hidden="true" />{copied ? 'コピーしました' : 'URLをコピー'}
            </button>
          </div>
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            「新しいQRにする」を押すと、いま表示しているQRは使えなくなります。読み取り済みでログイン中の人の支払い確定には影響しません。
          </p>
        </div>
      )}

      {fullscreen && current && paymentUrl && typeof document !== 'undefined' && createPortal(
        <div
          className="qr-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="支払いQRコード（全画面）"
        >
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
            {error && (
              <div className="error-banner" role="alert" style={{ marginBottom: 12 }}>
                <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}
            <div className="qr-fullscreen-code">
              <QRCodeSVG value={paymentUrl} size={1024} level="M" includeMargin />
            </div>
            <button
              type="button"
              className="btn btn-primary qr-fullscreen-refresh"
              onClick={() => void reissue()}
              disabled={reissuing}
            >
              <RefreshCw size={18} aria-hidden="true" />{reissuing ? '作り直しています…' : '新しいQRにする'}
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
