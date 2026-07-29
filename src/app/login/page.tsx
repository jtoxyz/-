'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { STUDENT_EMAIL_DOMAIN } from '@/lib/config';

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

export default function StudentLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState('/');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNextPath(params.get('next'));
    setNextPath(next);

    if (params.get('reason') === 'university-account') {
      setError('大阪産業大学のGoogleアカウントでログインしてください。');
    }

    supabase.auth.getSession().then(({ data }) => {
      const email = String(data.session?.user?.email || '').toLowerCase();
      if (/^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$/i.test(email)) {
        router.replace(next);
      }
    });
  }, [router]);

  const destinationLabel = useMemo(() => {
    if (nextPath.startsWith('/pay')) return '支払い確認画面へ戻ります';
    if (nextPath.startsWith('/reserve')) return '予約画面へ進みます';
    return '企画一覧へ進みます';
  }, [nextPath]);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);

    const redirectTo = `${window.location.origin}${nextPath}`;
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        scopes: 'openid email profile',
        queryParams: {
          hd: STUDENT_EMAIL_DOMAIN,
          prompt: 'select_account',
        },
      },
    });

    if (signInError) {
      setError(signInError.message || 'Googleログインを開始できませんでした。');
      setLoading(false);
    }
  };

  return (
    <div className="glass-card" style={{ maxWidth: 520, margin: '36px auto', padding: '32px' }}>
      <div style={{ textAlign: 'center' }}>
        <ShieldCheck size={48} strokeWidth={1.8} style={{ color: 'var(--color-primary)', marginBottom: 12 }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.55rem', marginBottom: 8 }}>大学アカウントでログイン</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 8 }}>
          予約・当日券・支払い確認には、大阪産業大学のGoogleアカウントが必要です。
        </p>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: 24 }}>{destinationLabel}</p>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 18 }}>{error}</div>}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleLogin}
        disabled={loading}
        style={{ width: '100%', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: 9 }}
      >
        <LogIn size={19} aria-hidden="true" />
        {loading ? 'Googleログインを開始しています...' : '大学Googleアカウントでログイン'}
      </button>

      <div style={{ marginTop: 20, padding: 14, borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--card-border)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        個人用Googleアカウントでは利用できません。メールアドレスが
        <strong style={{ marginLeft: 4 }}>@{STUDENT_EMAIL_DOMAIN}</strong>
        の大学アカウントを選択してください。
      </div>
    </div>
  );
}
