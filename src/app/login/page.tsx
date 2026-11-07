'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { STUDENT_EMAIL_DOMAIN, isStudentEmail } from '@/lib/config';
import { safeNextPath } from '@/lib/safeNextPath';
import { useQueryParam } from '@/hooks/useQueryParam';

function destinationLabel(nextPath: string): string {
  if (nextPath.startsWith('/pay')) return '支払い確認画面へ戻ります';
  if (nextPath.startsWith('/reserve')) return '予約画面へ進みます';
  if (nextPath.startsWith('/staff')) return 'スタッフ画面へ進みます';
  if (nextPath.startsWith('/tickets/find')) return 'チケットを探す画面へ進みます';
  return '企画一覧へ進みます';
}

export default function StudentLoginPage() {
  const router = useRouter();
  const nextParam = useQueryParam('next');
  const reason = useQueryParam('reason');
  const nextPath = nextParam === undefined ? '/' : safeNextPath(nextParam);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (nextParam === undefined) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active && isStudentEmail(data.session?.user?.email)) router.replace(nextPath);
    });
    return () => {
      active = false;
    };
  }, [nextParam, nextPath, router]);

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

  const shownError = error ?? (reason === 'university-account' ? '大阪産業大学のGoogleアカウントでログインしてください。' : null);

  return (
    <div className="glass-card" style={{ maxWidth: 520, margin: '36px auto', padding: '32px' }}>
      <div style={{ textAlign: 'center' }}>
        <ShieldCheck size={48} strokeWidth={1.8} style={{ color: 'var(--color-primary)', marginBottom: 12 }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.55rem', marginBottom: 8 }}>大学アカウントでログイン</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 8 }}>
          予約・当日券・支払い確認には、大阪産業大学のGoogleアカウントが必要です。
        </p>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 24 }}>{destinationLabel(nextPath)}</p>
      </div>

      {shownError && <div className="error-banner" role="alert" style={{ marginBottom: 18 }}>{shownError}</div>}

      <button
        type="button"
        className="btn btn-primary"
        onClick={handleLogin}
        disabled={loading}
      >
        <LogIn size={19} aria-hidden="true" />
        {loading ? 'Googleログインを開始しています...' : 'Googleでログイン'}
      </button>

      <div style={{ marginTop: 20, padding: 14, borderRadius: 10, background: 'var(--card-bg)', border: '1px solid var(--card-border)', fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
        個人用Googleアカウントでは利用できません。メールアドレスが
        <strong className="nowrap" style={{ marginLeft: 4 }}>@{STUDENT_EMAIL_DOMAIN}</strong>
        の大学アカウントを選択してください。
      </div>
    </div>
  );
}
