'use client';

import { useState } from 'react';
import { ScanLine } from 'lucide-react';
import { paymentTokenFromQr } from '@/lib/paymentQrUrl';
import QrCameraScanner from './QrCameraScanner';

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
      {open && (
        <QrCameraScanner
          title="受付に表示されている支払いQRコードを枠の中に写してください"
          fallbackHint="スマホのカメラアプリで受付のQRコードを読み取ってください。"
          rejectHint="支払い用のQRコードではありません。受付に表示されているQRコードを読み取ってください。"
          onDetect={(text) => {
            const token = paymentTokenFromQr(text, window.location.origin);
            // /pay は開いたときの URL から token を読むので、通常のページ移動で開く（ログイン状態はこのブラウザのまま）
            if (token) window.location.assign(`/pay?token=${encodeURIComponent(token)}`);
            return Boolean(token);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
