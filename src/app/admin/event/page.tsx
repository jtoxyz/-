'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminEditEventPage from '@/components/admin/AdminEditEventPage';

export default function AdminEventStaticPage() {
  const [id, setId] = useState<string | null>(null);

  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id'));
  }, []);

  if (!id) {
    return (
      <div className="glass-card text-center" style={{ padding: 36 }}>
        <div className="error-banner">企画が指定されていません。</div>
        <Link href="/admin/events"><button className="btn btn-secondary" style={{ marginTop: 18 }}>企画一覧へ戻る</button></Link>
      </div>
    );
  }

  return <AdminEditEventPage id={id} />;
}
