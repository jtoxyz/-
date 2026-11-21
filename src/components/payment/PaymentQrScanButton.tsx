'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanLine, TriangleAlert, X } from 'lucide-react';
import { paymentTokenFromQr } from '@/lib/paymentQrUrl';

// 1秒に5回ほど読み取る（端末の負担を抑えつつ、かざしてすぐ反応する程度）
const SCAN_INTERVAL_MS = 200;
// 読み取りに使う画像の長辺。大きすぎると古い端末で遅くなる
const MAX_SCAN_SIZE = 720;

type BarcodeDetectorLike = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type BarcodeDetectorCtor = new (options: { formats: string[] }) => BarcodeDetectorLike;
type Decoder = (canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) => Promise<string | null>;

/** 端末に QR の読み取り機能があればそれを使い、なければ jsQR（必要になったときだけ読み込む）を使う */
async function createDecoder(): Promise<Decoder> {
  const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (Native) {
    try {
      const detector = new Native({ formats: ['qr_code'] });
      return async (canvas) => {
        const codes = await detector.detect(canvas);
        return codes[0]?.rawValue ?? null;
      };
    } catch {
      // 対応していない形式などで作れなかったときは jsQR に切り替える
    }
  }
  const { default: jsQR } = await import('jsqr');
  return async (canvas, ctx) => {
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };
}

function cameraErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'カメラの使用が許可されていません。ブラウザの設定でカメラを許可するか、スマホのカメラアプリで受付のQRコードを読み取ってください。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'カメラが見つかりませんでした。スマホのカメラアプリで受付のQRコードを読み取ってください。';
  }
  return 'カメラを起動できませんでした。スマホのカメラアプリで受付のQRコードを読み取ってください。';
}

/**
 * 予約画面から、受付に表示されている支払いQRをその場で読み取るボタン。
 * カメラアプリで読むと別のブラウザが開いてログインを求められることがあるため、
 * ログイン済みのこの画面のまま読み取り、同じブラウザで支払い確認（/pay）へ進む。
 */
export default function PaymentQrScanButton({ style }: { style?: React.CSSProperties }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => setOpen(true)}
        style={{ width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style }}
      >
        <ScanLine size={20} aria-hidden="true" />支払いQRを読み取る
      </button>
      {open && <PaymentQrScanner onClose={() => setOpen(false)} />}
    </>
  );
}

function PaymentQrScanner({ onClose }: { onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let busy = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !ctx) {
        setError('この画面ではカメラを使えません。スマホのカメラアプリで受付のQRコードを読み取ってください。');
        setStarting(false);
        return;
      }
      try {
        const [media, decode] = await Promise.all([
          navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
          createDecoder(),
        ]);
        if (!active) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = media;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = media;
        await video.play().catch(() => {});
        if (!active) return;
        setStarting(false);

        timer = window.setInterval(async () => {
          if (busy || !active || video.readyState < 2 || !video.videoWidth) return;
          busy = true;
          try {
            const scale = Math.min(1, MAX_SCAN_SIZE / Math.max(video.videoWidth, video.videoHeight));
            canvas.width = Math.round(video.videoWidth * scale);
            canvas.height = Math.round(video.videoHeight * scale);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const text = await decode(canvas, ctx);
            if (!active || !text) return;
            const token = paymentTokenFromQr(text, window.location.origin);
            if (!token) {
              setHint('支払い用のQRコードではありません。受付に表示されているQRコードを読み取ってください。');
              return;
            }
            active = false;
            stop();
            // /pay は開いたときの URL から token を読むので、通常のページ移動で開く（ログイン状態はこのブラウザのまま）
            window.location.assign(`/pay?token=${encodeURIComponent(token)}`);
          } catch {
            // 1回の読み取り失敗は無視して次のフレームで読み直す
          } finally {
            busy = false;
          }
        }, SCAN_INTERVAL_MS);
      } catch (err) {
        if (!active) return;
        setError(cameraErrorMessage(err));
        setStarting(false);
      }
    };

    void start();
    return () => {
      active = false;
      stop();
    };
  }, []);

  // 開いている間は Esc で閉じられるようにする
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="qr-scanner" role="dialog" aria-modal="true" aria-label="支払いQRの読み取り">
      <button type="button" className="qr-scanner-close" onClick={onClose} aria-label="閉じる" autoFocus>
        <X size={28} aria-hidden="true" />
      </button>
      <div className="qr-scanner-body">
        <p className="qr-scanner-title">受付に表示されている支払いQRコードを枠の中に写してください</p>
        {error ? (
          <div className="error-banner" role="alert" style={{ textAlign: 'left' }}>
            <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        ) : (
          <div className="qr-scanner-view">
            <video ref={videoRef} playsInline muted autoPlay />
            <div className="qr-scanner-frame" aria-hidden="true" />
            {starting && <div className="qr-scanner-status" role="status">カメラを起動しています…</div>}
          </div>
        )}
        {!error && hint && <p className="qr-scanner-hint" role="status">{hint}</p>}
        <button type="button" className="btn qr-scanner-cancel" onClick={onClose}>やめる</button>
      </div>
    </div>,
    document.body,
  );
}
