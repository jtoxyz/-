'use client';

import type { ReactNode } from 'react';

type Props = {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  children: ReactNode;
};

/**
 * 毎回は使わない設定をチェックボックスの下にしまう。
 * チェックを外すと中身は隠れ、保存時には標準値が使われる（呼び出し側で処理する）。
 */
export default function OptionalSection({ label, hint, checked, onChange, disabled, children }: Props) {
  return (
    <div
      className="form-group"
      style={{
        padding: '12px 16px',
        borderRadius: 'var(--radius-md)',
        border: `1px solid ${checked ? 'var(--color-primary-border)' : 'var(--card-border)'}`,
        background: 'var(--card-bg)',
      }}
    >
      <label className="form-checkbox-label" style={{ fontWeight: 600 }}>
        <input
          type="checkbox"
          className="form-checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        {label}
      </label>
      {hint && <span className="form-hint" style={{ marginLeft: 28 }}>{hint}</span>}
      {checked && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  );
}
