'use client';

// アプリのGoogleログインで、スマホのブラウザ（Safari・Chrome）に戻ってくるページ。
// ここはアプリの外（ブラウザ）で開かれるので、受け取ったコードを持ってアプリに戻る（jp.gakkenpo.app://open?u=...）。
// コードは、ログインを始めたアプリの中でしかログイン状態に換えられない（PKCE）ので、ここで盗まれても使えない。
import { useEffect } from 'react';
import { appOpenUrl } from '@/lib/nativeApp';
import { safeNextPath } from '@/lib/safeNextPath';

function buildOpenUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const callback = new URL('/auth/app-callback', window.location.origin);
  const code = params.get('code');
  const error = params.get('error_description') || params.get('error');
  if (code) callback.searchParams.set('code', code);
  if (error) callback.searchParams.set('error', error);
  callback.searchParams.set('next', safeNextPath(params.get('next') ?? '/'));
  return appOpenUrl(callback.toString());
}

export default function AppReturnPage() {
  useEffect(() => {
    window.location.href = buildOpenUrl();
  }, []);

  return (
    <div className="glass-card" style={{ maxWidth: 480, margin: '36px auto', padding: 28, textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.3rem', marginBottom: 12 }}>アプリに戻っています</h1>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
        「がっけんぽ」アプリで開くか聞かれたら「開く」を押してください。
      </p>
      <button type="button" className="btn btn-primary" onClick={() => { window.location.href = buildOpenUrl(); }} style={{ width: '100%' }}>
        アプリに戻る
      </button>
    </div>
  );
}
