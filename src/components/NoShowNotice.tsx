'use client';

import { TriangleAlert } from 'lucide-react';
import { useAccessStatus } from '@/components/AccessStatusContext';
import { NOSHOW_BLACKLIST_COUNT } from '@/lib/accessStatus';

/**
 * 支払いに来なかったことがある学生に、予約サイトの上部で警告を出す。
 * 1回：黄色の注意、2回（イエローリスト）：赤の警告。
 * ブラックリストの人は StudentAuthGate で利用停止画面になるため、ここには来ない。
 */
export default function NoShowNotice() {
  const status = useAccessStatus();
  if (!status || status.level === 'blacklisted' || status.noshow_count < 1) return null;

  const remaining = Math.max(NOSHOW_BLACKLIST_COUNT - status.noshow_count, 1);

  if (status.level === 'yellow') {
    return (
      <div role="alert" className="error-banner" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 18, lineHeight: 1.7 }}>
        <TriangleAlert size={22} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>予約した支払い日時に来なかったことが{status.noshow_count}回あります。</strong>
          <div>
            {remaining === 1
              ? '次に予約した支払い日時に来なかった場合、予約サイトを利用できなくなります。'
              : `あと${remaining}回来なかった場合、予約サイトを利用できなくなります。`}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        marginBottom: 18,
        lineHeight: 1.7,
        padding: '12px 16px',
        borderRadius: 12,
        color: 'var(--color-warning)',
        background: 'var(--color-warning-bg)',
        border: '1px solid var(--color-warning-border)',
      }}
    >
      <TriangleAlert size={22} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <strong>予約した支払い日時に来なかったことが{status.noshow_count}回あります。</strong>
        <div>
          来なかった回数が{NOSHOW_BLACKLIST_COUNT}回になると、予約サイトを利用できなくなります（あと{remaining}回）。支払いは予約した日時に必ず来てください。
        </div>
      </div>
    </div>
  );
}
