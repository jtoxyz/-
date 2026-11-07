'use client';

import Link from 'next/link';
import AdminPreRegistrationsPage from '@/components/admin/AdminPreRegistrationsPage';
import { useQueryParam } from '@/hooks/useQueryParam';

export default function AdminPreRegistrationsStaticPage() {
  const id = useQueryParam('eventId');

  // まだ URL を読んでいない最初の描画では、エラーではなく読み込み中を出す
  if (id === undefined) {
    return <div style={{ textAlign: 'center', padding: '60px 0' }}><div className="loading-spinner" /></div>;
  }

  if (!id) {
    return (
      <div className="glass-card text-center" style={{ padding: 36 }}>
        <div className="error-banner">企画が指定されていません。</div>
        <Link href="/admin/events" className="btn btn-secondary" style={{ marginTop: 18 }}>企画一覧へ戻る</Link>
      </div>
    );
  }

  return <AdminPreRegistrationsPage id={id} />;
}
