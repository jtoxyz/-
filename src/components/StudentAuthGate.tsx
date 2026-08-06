'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const STUDENT_EMAIL_PATTERN = /^s[0-9]{2}[a-z][0-9]{3}@ge\.osaka-sandai\.ac\.jp$/i;

function isExcludedPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/account/setup' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/qr-maker') ||
    pathname.startsWith('/tickets/find')
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

export default function StudentAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;

    if (isExcludedPath(pathname)) {
      setReady(true);
      return () => {
        active = false;
      };
    }

    const checkAccount = async (session: Session | null) => {
      if (!active) return;

      if (!session?.user) {
        setReady(false);
        router.replace(loginPath(pathname));
        return;
      }

      const email = String(session.user.email || '').trim().toLowerCase();
      if (!STUDENT_EMAIL_PATTERN.test(email)) {
        await supabase.auth.signOut();
        if (!active) return;
        setReady(false);
        router.replace(loginPath(pathname, 'university-account'));
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
        setReady(false);
        return;
      }

      if (!profile) {
        const params = new URLSearchParams();
        params.set('next', currentPath(pathname));
        setReady(false);
        router.replace(`/account/setup?${params.toString()}`);
        return;
      }

      setReady(true);
    };

    supabase.auth.getSession().then(({ data }) => checkAccount(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void checkAccount(session);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (!ready) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 20px' }}>
        <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
        <p style={{ color: 'var(--text-secondary)' }}>アカウント情報を確認しています...</p>
      </div>
    );
  }

  return <>{children}</>;
}
