'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AdminPreRegistrationsPage from '@/components/admin/AdminPreRegistrationsPage';

export default function AdminPreRegistrationsStaticPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('eventId'));
  }, []);

  const params = useMemo(() => id ? Promise.resolve({ id }) : null, [id]);

  if (!params) {
    return (
      <div className="glass-card text-center" style={{ padding: 36 }}>
        <div className="error-banner">企画が指定されていません。</div>
        <Link href="/admin/events"><button className="btn btn-secondary" style={{ marginTop: 18 }}>企画一覧へ戻る</button></Link>
      </div>
    );
  }

  return <AdminPreRegistrationsPage params={params} />;
}
