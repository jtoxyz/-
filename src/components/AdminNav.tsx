'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  BadgeCheck,
  Ban,
  Banknote,
  CalendarDays,
  CirclePlus,
  DoorOpen,
  FileText,
  GraduationCap,
  IdCard,
  LogOut,
  QrCode,
  RefreshCw,
  Users,
} from 'lucide-react';
import { adminSupabase as supabase } from '@/lib/supabase';

const iconStyle = { marginRight: '6px', verticalAlign: 'middle', flexShrink: 0 } as const;

const LINKS = [
  ['/admin/events', CalendarDays, '企画一覧・管理'],
  ['/admin/events/new', CirclePlus, '新規企画作成'],
  ['/admin/users', Users, '利用者管理'],
  ['/admin/staff', IdCard, 'スタッフ管理'],
  ['/admin/settings/payment', Banknote, '支払い設定'],
  ['/admin/payment-management', BadgeCheck, '支払い管理'],
  ['/admin/payment-visits', DoorOpen, '委員会室 支払い受付'],
  ['/admin/payment-qr', RefreshCw, '動的支払いQR'],
  ['/admin/daily-payment-qr', FileText, '1日支払いQR'],
  ['/qr-maker', QrCode, 'QRコード作成'],
  ['/admin/settings/student-number', GraduationCap, '学籍番号設定'],
  ['/admin/blacklist', Ban, 'ブラックリスト'],
] as const;

/** 企画の編集・予約者一覧などは「企画一覧・管理」の中のページとして強調する */
function isActive(pathname: string, href: string): boolean {
  if (pathname === href) return true;
  if (href === '/admin/events') {
    return ['/admin/event', '/admin/reservations', '/admin/pre-registrations'].includes(pathname);
  }
  return false;
}

export default function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
      router.push('/admin/login');
    } catch (e) {
      console.error('Logout error', e);
    }
  };

  return (
    <nav className="admin-navbar" aria-label="管理メニュー">
      {LINKS.map(([href, Icon, label]) => {
        const active = isActive(pathname, href);
        return (
          <Link key={href} href={href} className={`admin-nav-link ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            <Icon size={18} style={iconStyle} aria-hidden="true" />{label}
          </Link>
        );
      })}

      <button type="button" onClick={handleLogout} className="admin-nav-link" style={{ border: 'none', cursor: 'pointer', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', marginLeft: 'auto' }}>
        <LogOut size={18} style={iconStyle} aria-hidden="true" />ログアウト
      </button>
    </nav>
  );
}
