'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/admin/login');
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  return (
    <div className="admin-navbar">
      <Link
        href="/admin/events"
        className={`admin-nav-link ${pathname === '/admin/events' ? 'active' : ''}`}
      >
        📅 企画一覧・管理
      </Link>
      <Link
        href="/admin/events/new"
        className={`admin-nav-link ${pathname === '/admin/events/new' ? 'active' : ''}`}
      >
        ➕ 新規企画作成
      </Link>
      <button
        onClick={handleLogout}
        className="admin-nav-link"
        style={{
          border: 'none',
          cursor: 'pointer',
          background: 'rgba(244, 63, 94, 0.15)',
          color: 'var(--color-danger)',
          marginLeft: 'auto',
        }}
      >
        🚪 ログアウト
      </button>
    </div>
  );
}
