'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminAuth } from '@/hooks/useAdminAuth';

export default function AdminPage() {
  const { loading, user } = useAdminAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.push('/admin/events');
    }
  }, [loading, user, router]);

  return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <div className="loading-spinner"></div>
      <p style={{ color: 'var(--text-secondary)' }}>管理者セッションを検証中...</p>
    </div>
  );
}
