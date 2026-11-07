'use client';

/** 説明文などに、色付き文字・注意書きの専用タグ（parseShortcodes で表示）を差し込むボタン */
const TAGS = [
  { tag: 'red', label: '赤字(重要)', placeholder: '重要なテキスト', color: 'var(--color-danger)' },
  { tag: 'orange', label: 'オレンジ(注意)', placeholder: '注意テキスト', color: 'var(--color-warning)' },
  { tag: 'blue', label: '青字(補足)', placeholder: '補足テキスト', color: 'var(--color-primary)' },
  { tag: 'green', label: '緑字(案内)', placeholder: '案内テキスト', color: 'var(--color-success)' },
  { tag: 'alert', label: '注意書きブロック', placeholder: '注意書きブロック内容', color: null },
] as const;

export default function FormatToolbar({
  targetId,
  onChange,
  disabled,
}: {
  /** 書き込む textarea の id */
  targetId: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const apply = (tag: string, placeholder: string) => {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    const selected = value.substring(start, end) || placeholder;
    const prefix = `[${tag}:`;
    onChange(`${value.substring(0, start)}${prefix}${selected}]${value.substring(end)}`);
    // 差し込んだ文字を選んだ状態にして、そのまま打ち直せるようにする
    window.setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    }, 0);
  };

  return (
    <div className="format-toolbar" role="toolbar" aria-label="文字の装飾" style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
      {TAGS.map(({ tag, label, placeholder, color }) => (
        <button
          key={tag}
          type="button"
          className="btn btn-secondary"
          disabled={disabled}
          style={{
            padding: '4px 8px',
            fontSize: '0.8rem',
            ...(color ? { color, borderColor: color } : { background: 'var(--bg-secondary)', borderColor: 'var(--card-border)' }),
          }}
          onClick={() => apply(tag, placeholder)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
