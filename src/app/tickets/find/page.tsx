'use client';

import { useEffect } from 'react';

export default function LegacyTicketSearchPage() {
  useEffect(() => {
    window.location.replace('/#my-tickets');
  }, []);

  return (
    <div style={{ textAlign: 'center', padding: 64 }}>
      <div className="loading-spinner" style={{ margin: '0 auto 16px' }} />
      <p style={{ color: 'var(--text-secondary)' }}>自分の予約を開いています...</p>
    </div>
  );
}
