'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isStudentEmail } from '@/lib/config';

function isExcludedPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/account/setup' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/qr-maker') ||
    // スタッフ画面は自分でログインとスタッフ登録を確認する（初回の氏名登録は不要）
    pathname.startsWith('/staff') ||
    // 支払いQRはログイン前に読み取り済みにする必要があるため、ログインは /pay 側で行う
    pathname.startsWith('/pay')
  );
}

function currentPath(pathname: string): string {
  if (typeof window === 'undefined') return pathname;
  return `${pathname}${window.location.search}`;
}

function loginPath(pathname: string, reason?: string): string {
  const params = new URLSearchParams();
  params.set('next', currentPath(pathname));
  if (reason) params.set('reason', reason);
  return `/login?${params.toString()}`;
}

// 初回登録まで確認できた利用者。ページを移るたびにプロフィールを読み直さないよう覚えておく
let verifiedUserId: string | null = null;

type GateState = 'checking' | 'ready' | 'error';

export default function StudentAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const excluded = isExcludedPath(pathname);
  const [state, setState] = useState<GateState>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (excluded) return;
    let active = true;

    const checkAccount = async (session: Session | null) => {
      if (!active) return;

      if (!session?.user) {
        verifiedUserId = null;
        setState('checking');
        router.replace(loginPath(pathname));
        return;
      }

      if (!isStudentEmail(session.user.email)) {
        // 管理者のログインは別のクライアント（adminSupabase）にあるので、ここでログアウトしても管理画面はそのまま
        verifiedUserId = null;
        await supabase.auth.signOut({ scope: 'local' });
        if (!active) return;
        setState('checking');
        router.replace(loginPath(pathname, 'university-account'));
        return;
      }

      if (verifiedUserId === session.user.id) {
        setState('ready');
        return;
      }

      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (!active) return;

      if (error) {
        console.error('Profile check failed:', error);
        setState('error');
        return;
      }

      if (!profile) {
        const params = new URLSearchParams();
        params.set('next', currentPath(pathname));
        setState('checking');
        router.replace(`/account/setup?${params.toString()}`);
        return;
      }

      verifiedUserId = session.user.id;
      setState('ready');
    };

    void supabase.auth.getSession().then(({ data }) => checkAccount(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // トークンの更新（TOKEN_REFRESHED）や初回通知（INITIAL_SESSION）では確認し直さない
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        void checkAccount(session);
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [excluded, pathname, router, attempt]);

  if (excluded || state === 'ready') return <>{children}</>;

  if (state === 'error') {
    return (
      <div className="glass-card text-center" style={{ maxWidth: 520, margin: '40px auto', padding: 28 }}>
        <div className="error-banner" role="alert" style={{ textAlign: 'left' }}>
          <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>アカウント情報を確認できませんでした。通信状況を確認して、もう一度お試しください。</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setState('checking');
            setAttempt((n) => n + 1);
          }}
        >
          もう一度確認する
        </button>
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '64px 20px' }} role="status">
      <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
      <p style={{ color: 'var(--text-secondary)' }}>アカウント情報を確認しています...</p>
    </div>
  );
}
