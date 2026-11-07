'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import AdminNav from '@/components/AdminNav';
import { adminSupabase as supabase } from '@/lib/supabase';
import { downloadPng as savePng, downloadSvg as saveSvg } from '@/lib/qrDownload';

export default function QrMakerPage() {
  const [url, setUrl] = useState('');
  const [size, setSize] = useState(512);
  const svgWrapRef = useRef<HTMLDivElement>(null);
  const value = useMemo(() => url.trim(), [url]);
  // 管理画面のメニューから開いたときに一覧が消えないよう、管理者には管理メニューを出す（ログインなしでも使える）
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const { data } = await supabase.from('admin_users').select('user_id').eq('user_id', session.user.id).maybeSingle();
      if (active) setIsAdmin(Boolean(data));
    };
    void checkAdmin();
    return () => {
      active = false;
    };
  }, []);

  const qrSvg = () => svgWrapRef.current?.querySelector('svg');
  const downloadSvg = () => {
    if (value) saveSvg(qrSvg(), 'qr-code.svg');
  };
  const downloadPng = () => {
    if (value) savePng(qrSvg(), size, 'qr-code.png');
  };

  const content = (
    <div style={isAdmin ? { maxWidth: 860 } : { maxWidth: 860, margin: '0 auto', paddingTop: 16 }}>
      <div className="glass-card">
        <h1 style={{ marginTop: 0 }}>URLからQRコード作成</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          URLを貼り付けると、その場でQRコードを作成します。PNGは画像用、SVGは印刷や拡大用です。
        </p>

        <div className="form-group">
          <label className="form-label" htmlFor="qr-text">URLまたは文字列</label>
          <textarea
            id="qr-text"
            className="form-input"
            rows={4}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com"
            style={{ resize: 'vertical' }}
          />
        </div>

        <div className="form-group" style={{ maxWidth: 260 }}>
          <label className="form-label" htmlFor="qr-size">保存サイズ</label>
          <select id="qr-size" className="form-input" value={size} onChange={(event) => setSize(Number(event.target.value))}>
            <option value={256}>256 × 256</option>
            <option value={512}>512 × 512</option>
            <option value={1024}>1024 × 1024</option>
            <option value={2048}>2048 × 2048</option>
          </select>
        </div>

        {value ? (
          <section style={{ textAlign: 'center', marginTop: 24 }}>
            <div ref={svgWrapRef} className="qr-frame">
              <QRCodeSVG value={value} size={Math.min(size, 520)} level="M" includeMargin />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={downloadPng}>PNGで保存</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={downloadSvg}>SVGで保存</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => window.print()}>印刷</button>
            </div>
          </section>
        ) : (
          <div style={{ padding: 36, textAlign: 'center', color: 'var(--text-secondary)' }}>URLを入力するとQRコードが表示されます。</div>
        )}
      </div>
    </div>
  );

  if (!isAdmin) return content;

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        {content}
      </div>
    </div>
  );
}
