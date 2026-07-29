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
  Users,
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
    const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('.reservations-table-desktop tbody tr'));
    return rows
      .filter((row) => row.style.opacity !== '0.4')
      .map((row) => row.querySelectorAll<HTMLTableCellElement>('td')[columnIndex]?.textContent?.trim() || '')
      .filter(Boolean);
  };

  const copyReservationColumn = async (columnIndex: number, emptyMessage: string, successLabel: string) => {
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

  const links = [
    ['/admin/events', CalendarDays, '企画一覧・管理'],
    ['/admin/events/new', CirclePlus, '新規企画作成'],
    ['/admin/users', Users, '利用者管理'],
    ['/admin/settings/payment', Banknote, '支払い設定'],
    ['/admin/payment-management', BadgeCheck, '支払い管理'],
    ['/admin/payment-qr', RefreshCw, '動的支払いQR'],
    ['/admin/daily-payment-qr', FileText, '1日支払いQR'],
    ['/qr-maker', QrCode, 'QRコード作成'],
    ['/admin/settings/student-number', GraduationCap, '学籍番号設定'],
    ['/admin/blacklist', Ban, 'ブラックリスト'],
  ] as const;

  return (
    <div className="admin-navbar">
      {links.map(([href, Icon, label]) => (
        <Link key={href} href={href} className={`admin-nav-link ${pathname === href ? 'active' : ''}`}>
          <Icon size={18} style={iconStyle} aria-hidden="true" />{label}
        </Link>
      ))}

      {isReservationsPage && (
        <>
          <button type="button" onClick={() => copyReservationColumn(2, 'コピーできる有効な予約者がいません。', '氏名')} className="admin-nav-link" style={{ border: 'none', cursor: 'pointer', background: 'var(--color-primary-glow)', color: 'var(--color-primary)' }}>
            <ClipboardCopy size={18} style={iconStyle} aria-hidden="true" />氏名のみコピー
          </button>
          <button type="button" onClick={() => copyReservationColumn(3, 'コピーできる有効な学籍番号がありません。', '学籍番号')} className="admin-nav-link" style={{ border: 'none', cursor: 'pointer', background: 'var(--color-primary-glow)', color: 'var(--color-primary)' }}>
            <GraduationCap size={18} style={iconStyle} aria-hidden="true" />学籍番号のみコピー
          </button>
        </>
      )}

      <button onClick={handleLogout} className="admin-nav-link" style={{ border: 'none', cursor: 'pointer', background: 'rgba(244, 63, 94, 0.15)', color: 'var(--color-danger)', marginLeft: 'auto' }}>
        <LogOut size={18} style={iconStyle} aria-hidden="true" />ログアウト
      </button>
    </div>
  );
}
