// [重要度: 低]
// 管理画面で入力された色名を、現在のテーマに対応するCSS変数へ変換する表示用設定。
const colorStyles: Record<string, string> = {
  red: 'var(--color-danger)',
  orange: 'var(--color-warning)',
  blue: 'var(--color-primary)',
  green: 'var(--color-success)',
};

// [重要度: 低]
// 注意書きショートコードをカード状に表示するための共通インラインスタイル。
const alertStyle = 'background:var(--bg-secondary);border-left:4px solid var(--color-warning);padding:12px;margin:16px 0;border-radius:4px;';

// [重要度: 中]
// 管理画面で入力された独自ショートコードをHTMLへ変換し、企画説明や注意事項で装飾表示できるようにする。
// 変換後のHTMLは呼び出し側でDOMPurifyによりサニタイズされる前提のため、単独で安全なHTML生成処理として使わないこと。
export function parseShortcodes(text: string | null | undefined): string {
  if (!text) return '';

  let result = text;

  // Nested form used by the admin editor, for example:
  // [alert:[red:important message]]
  // [重要度: 中]
  // 入れ子形式は通常の色変換より先に処理しないと、内側だけが先に置換されて構造が崩れるため順序を維持する。
  result = result.replace(
    /\[alert:\[(red|orange|blue|green):([\s\S]*?)\]\]/g,
    (_match, color: string, content: string) =>
      `<div style="${alertStyle}"><span style="color:${colorStyles[color]};font-weight:600;">${content}</span></div>`
  );

  // Standard alert block. Supports line breaks.
  // [重要度: 低]
  // 改行を含む通常のalertショートコードを注意書きブロックへ変換する。
  result = result.replace(
    /\[alert:([\s\S]*?)\]/g,
    `<div style="${alertStyle}">$1</div>`
  );

  // [重要度: 低]
  // 色指定ショートコードをテーマ対応の強調表示へ変換する。
  result = result.replace(/\[red:([\s\S]*?)\]/g, '<span style="color:var(--color-danger);font-weight:600;">$1</span>');
  result = result.replace(/\[orange:([\s\S]*?)\]/g, '<span style="color:var(--color-warning);font-weight:600;">$1</span>');
  result = result.replace(/\[blue:([\s\S]*?)\]/g, '<span style="color:var(--color-primary);font-weight:600;">$1</span>');
  result = result.replace(/\[green:([\s\S]*?)\]/g, '<span style="color:var(--color-success);font-weight:600;">$1</span>');

  return result;
}