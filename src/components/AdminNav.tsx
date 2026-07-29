'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  BadgeCheck,
  Ban,
  Banknote,
  CalendarDays,
  CirclePlus,
  ClipboardCopy,
  FileText,
  GraduationCap,
  LogOut,
  QrCode,
  RefreshCw,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

const iconStyle = { marginRight: '6px', verticalAlign: 'middle' } as const;

export default function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();
  const isReservationsPage = /^\/admin\/events\/[^/]+\/reservations$/.test(pathname);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/admin/login');
    } catch (e) {
      console.error('Logout error', e);
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
      <Link href="/admin/events" className={`admin-nav-link ${pathname === '/admin/events' ? 'active' : ''}`}>
        <CalendarDays size={18} style={iconStyle} aria-hidden="true" />企画一覧・管理
      </Link>
      <Link href="/admin/events/new" className={`admin-nav-link ${pathname === '/admin/events/new' ? 'active' : ''}`}>
        <CirclePlus size={18} style={iconStyle} aria-hidden="true" />新規企画作成
      </Link>
      <Link href="/admin/settings/payment" className={`admin-nav-link ${pathname === '/admin/settings/payment' ? 'active' : ''}`}>
        <Banknote size={18} style={iconStyle} aria-hidden="true" />支払い設定
      </Link>
      <Link href="/admin/payment-management" className={`admin-nav-link ${pathname === '/admin/payment-management' ? 'active' : ''}`}>
        <BadgeCheck size={18} style={iconStyle} aria-hidden="true" />支払い管理
      </Link>
      <Link href="/admin/payment-qr" className={`admin-nav-link ${pathname === '/admin/payment-qr' ? 'active' : ''}`}>
        <RefreshCw size={18} style={iconStyle} aria-hidden="true" />動的支払いQR
      </Link>
      <Link href="/admin/daily-payment-qr" className={`admin-nav-link ${pathname === '/admin/daily-payment-qr' ? 'active' : ''}`}>
        <FileText size={18} style={iconStyle} aria-hidden="true" />1日支払いQR
      </Link>
      <Link href="/qr-maker" className={`admin-nav-link ${pathname === '/qr-maker' ? 'active' : ''}`}>
        <QrCode size={18} style={iconStyle} aria-hidden="true" />QRコード作成
      </Link>
      <Link href="/admin/settings/student-number" className={`admin-nav-link ${pathname === '/admin/settings/student-number' ? 'active' : ''}`}>
        <GraduationCap size={18} style={iconStyle} aria-hidden="true" />学籍番号設定
      </Link>
      <Link href="/admin/blacklist" className={`admin-nav-link ${pathname === '/admin/blacklist' ? 'active' : ''}`}>
        <Ban size={18} style={iconStyle} aria-hidden="true" />ブラックリスト
      </Link>
      {isReservationsPage && (
        <>
          <button
            type="button"
            onClick={() => copyReservationColumn(2, 'コピーできる有効な予約者がいません。', '氏名')}
            className="admin-nav-link"
            style={{ border: 'none', cursor: 'pointer', background: 'var(--color-primary-glow)', color: 'var(--color-primary)' }}
          >
            <ClipboardCopy size={18} style={iconStyle} aria-hidden="true" />氏名のみコピー
          </button>
          <button
            type="button"
            onClick={() => copyReservationColumn(3, 'コピーできる有効な学籍番号がありません。', '学籍番号')}
            className="admin-nav-link"
            style={{ border: 'none', cursor: 'pointer', background: 'var(--color-primary-glow)', color: 'var(--color-primary)' }}
          >
            <GraduationCap size={18} style={iconStyle} aria-hidden="true" />学籍番号のみコピー
          </button>
        </>
      )}
      <button
        onClick={handleLogout}
        className="admin-nav-link"
        style={{ border: 'none', cursor: 'pointer', background: 'rgba(244, 63, 94, 0.15)', color: 'var(--color-danger)', marginLeft: 'auto' }}
      >
        <LogOut size={18} style={iconStyle} aria-hidden="true" />ログアウト
      </button>
    </div>
  );
}
