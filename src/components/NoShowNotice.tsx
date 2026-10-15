'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type NoShowStatus = { noshow_count: number; level: 'normal' | 'yellow' | 'blacklisted' };

/** 支払いに来なかった回数が多い学生に、予約サイトの上部で警告を出す（2回：イエロー、3回：利用制限中） */
export default function NoShowNotice() {
  const pathname = usePathname();
  const [status, setStatus] = useState<NoShowStatus | null>(null);
  const hidden = pathname.startsWith('/admin') || pathname.startsWith('/qr-maker');

  useEffect(() => {
    if (hidden) return;
    let active = true;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        if (active) setStatus(null);
        return;
      }
      const { data, error } = await supabase.rpc('get_my_noshow_status');
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : data;
      setStatus(error ? null : ((row as NoShowStatus | undefined) || null));
    };

    void load();
    const { data: listener } = supabase.auth.onAuthStateChange(() => void load());
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [hidden]);

  if (hidden || !status || status.level === 'normal') return null;

  const blacklisted = status.level === 'blacklisted';
  return (
    <div
      role="alert"
      className="error-banner"
      style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 18, lineHeight: 1.7 }}
    >
      <TriangleAlert size={22} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        {blacklisted ? (
          <>
            <strong>予約サイトの利用が制限されています。</strong>
            <div>予約した支払い日時に来なかったことが{status.noshow_count}回あったため、利用を制限しています。お問い合わせは学生健康保険委員会までお願いします。</div>
          </>
        ) : (
          <>
            <strong>予約した支払い日時に来なかったことが{status.noshow_count}回あります。</strong>
            <div>次に予約した支払い日時に来なかった場合、予約サイトの利用を制限します。</div>
          </>
        )}
      </div>
    </div>
  );
}
