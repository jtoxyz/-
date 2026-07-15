'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();
  const isReservationsPage = /^\/admin\/events\/[^/]+\/reservations$/.test(pathname);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/admin/login');
    } catch (e) {
      console.error('Logout error:', e);
    }
  };

  const handleCopyReservationNames = async () => {
    const rows = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('.reservations-table-desktop tbody tr')
    );

    const names = rows
      .filter((row) => row.style.opacity !== '0.4')
      .map((row) => row.querySelectorAll<HTMLTableCellElement>('td')[2]?.textContent?.trim() || '')
      .filter(Boolean);

    if (names.length === 0) {
      alert('コピーできる有効な予約者がいません。');
      return;
    }

    try {
      await navigator.clipboard.writeText(names.join('\n'));
      alert(`${names.length}名の氏名をクリップボードにコピーしました。`);
    } catch (error) {
      console.error('氏名のコピーに失敗しました:', error);
      alert('クリップボードへのコピーに失敗しました。');
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
      {isReservationsPage && (
        <button
          type="button"
          onClick={handleCopyReservationNames}
          className="admin-nav-link"
          style={{
            border: 'none',
            cursor: 'pointer',
            background: 'var(--color-primary-glow)',
            color: 'var(--color-primary)',
          }}
        >
          📋 氏名のみコピー
        </button>
      )}
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
