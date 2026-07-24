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

  const getActiveReservationColumnValues = (columnIndex: number): string[] => {
    const rows = Array.from(
      document.querySelectorAll<HTMLTableRowElement>('.reservations-table-desktop tbody tr')
    );

    return rows
      .filter((row) => row.style.opacity !== '0.4')
      .map((row) => row.querySelectorAll<HTMLTableCellElement>('td')[columnIndex]?.textContent?.trim() || '')
      .filter(Boolean);
  };

  const copyReservationColumn = async (
    columnIndex: number,
    emptyMessage: string,
    successLabel: string
  ) => {
    const values = getActiveReservationColumnValues(columnIndex);

    if (values.length === 0) {
      alert(emptyMessage);
      return;
    }

    try {
      await navigator.clipboard.writeText(values.join('\n'));
      alert(`${values.length}件の${successLabel}をクリップボードにコピーしました。`);
    } catch (error) {
      console.error(`${successLabel}のコピーに失敗しました:`, error);
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
      <Link
        href="/admin/settings/student-number"
        className={`admin-nav-link ${pathname === '/admin/settings/student-number' ? 'active' : ''}`}
      >
        🎓 学籍番号設定
      </Link>
      <Link
        href="/admin/blacklist"
        className={`admin-nav-link ${pathname === '/admin/blacklist' ? 'active' : ''}`}
      >
        🚫 ブラックリスト
      </Link>
      {isReservationsPage && (
        <>
          <button
            type="button"
            onClick={() => copyReservationColumn(2, 'コピーできる有効な予約者がいません。', '氏名')}
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
          <button
            type="button"
            onClick={() => copyReservationColumn(3, 'コピーできる有効な学籍番号がありません。', '学籍番号')}
            className="admin-nav-link"
            style={{
              border: 'none',
              cursor: 'pointer',
              background: 'var(--color-primary-glow)',
              color: 'var(--color-primary)',
            }}
          >
            🎓 学籍番号のみコピー
          </button>
        </>
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
