'use client';

import { useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export default function QrMakerPage() {
  const [url, setUrl] = useState('');
  const [size, setSize] = useState(512);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const value = useMemo(() => url.trim(), [url]);

  const downloadSvg = () => {
    const svg = svgWrapRef.current?.querySelector('svg');
    if (!svg || !value) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'qr-code.svg';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const downloadPng = () => {
    const svg = svgWrapRef.current?.querySelector('svg');
    if (!svg || !value) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, size, size);
      context.drawImage(image, 0, 0, size, size);
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = 'qr-code.png';
      link.click();
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
  };

  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '40px 20px' }}>
      <div className="glass-card">
        <h1 style={{ marginTop: 0 }}>URLからQRコード作成</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          URLを貼り付けると、その場でQRコードを作成します。PNGは画像用、SVGは印刷や拡大用です。
        </p>

        <div className="form-group">
          <label className="form-label">URLまたは文字列</label>
          <textarea
            className="form-input"
            rows={4}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            style={{ resize: 'vertical' }}
          />
        </div>

        <div className="form-group" style={{ maxWidth: 260 }}>
          <label className="form-label">保存サイズ</label>
          <select className="form-input" value={size} onChange={(event) => setSize(Number(event.target.value))}>
            <option value={256}>256 × 256</option>
            <option value={512}>512 × 512</option>
            <option value={1024}>1024 × 1024</option>
            <option value={2048}>2048 × 2048</option>
          </select>
        </div>

        {value ? (
          <section style={{ textAlign: 'center', marginTop: 24 }}>
            <div ref={svgWrapRef} style={{ display: 'inline-flex', padding: 20, background: '#fff', borderRadius: 16 }}>
              <QRCodeSVG value={value} size={Math.min(size, 520)} level="M" includeMargin />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
              <button className="btn btn-primary" onClick={downloadPng}>PNGで保存</button>
              <button className="btn btn-secondary" onClick={downloadSvg}>SVGで保存</button>
              <button className="btn btn-secondary" onClick={() => window.print()}>印刷</button>
            </div>
          </section>
        ) : (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)' }}>URLを入力するとQRコードが表示されます。</div>
        )}
      </div>
    </main>
  );
}
