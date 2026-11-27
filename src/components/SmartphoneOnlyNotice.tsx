import { Smartphone } from 'lucide-react';
import { SMARTPHONE_ONLY_NOTICE } from '@/lib/deviceKind';

/** 「受付・受取はスマホのみです」の案内 */
export default function SmartphoneOnlyNotice({ style }: { style?: React.CSSProperties }) {
  return (
    <div
      role="note"
      style={{
        display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10,
        fontSize: '0.85rem', lineHeight: 1.7, fontWeight: 700,
        color: 'var(--color-warning)', background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)',
        ...style,
      }}
    >
      <Smartphone size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }} />
      <span>{SMARTPHONE_ONLY_NOTICE}</span>
    </div>
  );
}
