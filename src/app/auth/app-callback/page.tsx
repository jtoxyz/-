'use client';

// アプリの中に戻ってきたあとのページ（アプリが jp.gakkenpo.app://open?u=... を受けて、ここを開く）。
// ブラウザでのGoogleログインで受け取ったコードを、ログイン状態に換えて学生用クライアントに移す。
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { appOAuthSupabase, supabase } from '@/lib/supabase';
import { safeNextPath } from '@/lib/safeNextPath';

export default function AppCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNextPath(params.get('next') ?? '/');
    const code = params.get('code');
    (async () => {
      if (!code) {
        setError(params.get('error') || 'ログインがキャンセルされました。');
        return;
      }
      const { data, error: exchangeError } = await appOAuthSupabase.auth.exchangeCodeForSession(code);
      if (exchangeError || !data.session) {
        setError('ログインを完了できませんでした。もう一度お試しください。');
        return;
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      // このクライアントの役目は終わり（ログイン状態は学生用クライアントが持つ）
      await appOAuthSupabase.auth.signOut({ scope: 'local' }).catch(() => {});
      if (setErr) {
        setError('ログインを完了できませんでした。もう一度お試しください。');
        return;
      }
      router.replace(next);
    })();
  }, [router]);

  return (
    <div className="glass-card" style={{ maxWidth: 480, margin: '36px auto', padding: 28, textAlign: 'center' }}>
      {error ? (
        <>
          <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>
          <a className="btn btn-primary" href="/login" style={{ width: '100%' }}>ログイン画面へ</a>
        </>
      ) : (
        <p style={{ color: 'var(--text-secondary)' }}>ログインしています...</p>
      )}
    </div>
  );
}
