'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Profile = {
  student_name: string;
  student_number: string;
};

export default function StudentAccountMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (pathname.startsWith('/admin') || pathname.startsWith('/qr-maker')) {
      setProfile(null);
      return;
    }

    let active = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) {
        if (active) setProfile(null);
        return;
      }

      const { data } = await supabase
        .from('user_profiles')
        .select('student_name, student_number')
        .eq('user_id', user.id)
        .maybeSingle();

      if (active) setProfile((data as Profile | null) || null);
    };

    void load();
    const { data: listener } = supabase.auth.onAuthStateChange(() => void load());

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    router.replace('/login');
    router.refresh();
  };

  if (!profile) return null;

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Link
        href="/"
        title={`${profile.student_name}（${profile.student_number}）`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--text-secondary)', maxWidth: 160 }}
      >
        <UserRound size={17} aria-hidden="true" />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.student_name}</span>
      </Link>
      <button
        type="button"
        onClick={handleLogout}
        title="ログアウト"
        aria-label="ログアウト"
        style={{ border: 0, background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer', display: 'inline-flex', padding: 4 }}
      >
        <LogOut size={17} aria-hidden="true" />
      </button>
    </div>
  );
}
