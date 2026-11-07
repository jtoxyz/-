'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BadgeCheck, LogOut, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Profile = {
  student_name: string;
  student_number: string;
};

type MenuState = { profile: Profile | null; isStaff: boolean };

export default function StudentAccountMenu() {
  const pathname = usePathname();
  const hidden = pathname.startsWith('/admin') || pathname.startsWith('/qr-maker');
  const [state, setState] = useState<MenuState>({ profile: null, isStaff: false });

  useEffect(() => {
    if (hidden) return;
    let active = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) {
        if (active) setState({ profile: null, isStaff: false });
        return;
      }

      const [profileResult, staffResult] = await Promise.all([
        supabase.from('user_profiles').select('student_name, student_number').eq('user_id', user.id).maybeSingle(),
        supabase.rpc('get_my_staff_status'),
      ]);
      if (!active) return;
      const staffRow = Array.isArray(staffResult.data) ? staffResult.data[0] : staffResult.data;
      setState({
        profile: (profileResult.data as Profile | null) || null,
        isStaff: Boolean(!staffResult.error && (staffRow as { is_staff?: boolean } | null)?.is_staff),
      });
    };

    void load();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void load();
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [hidden]);

  const handleLogout = async () => {
    await supabase.auth.signOut({ scope: 'local' });
    setState({ profile: null, isStaff: false });
  };

  const { profile, isStaff } = state;
  if (hidden || (!profile && !isStaff)) return null;

  // 区切り線もここで出す（未ログイン・管理画面では区切り線が二重にならないように）
  return (
    <>
      {isStaff && (
        <>
          <Link href="/staff" className="header-nav-link" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <BadgeCheck size={16} aria-hidden="true" />スタッフ
          </Link>
          <span className="header-nav-sep" aria-hidden="true">|</span>
        </>
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        {profile && (
          <Link
            href="/"
            title={`${profile.student_name}（${profile.student_number}）`}
            className="header-nav-link"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: 160 }}
          >
            <UserRound size={17} aria-hidden="true" />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{profile.student_name}</span>
          </Link>
        )}
        <button
          type="button"
          onClick={handleLogout}
          title="ログアウト"
          aria-label="ログアウト"
          className="icon-button"
        >
          <LogOut size={17} aria-hidden="true" />
        </button>
      </div>
      <span className="header-nav-sep" aria-hidden="true">|</span>
    </>
  );
}
