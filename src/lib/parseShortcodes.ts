const colorStyles: Record<string, string> = {
  red: 'var(--color-danger)',
  orange: 'var(--color-warning)',
  blue: 'var(--color-primary)',
  green: 'var(--color-success)',
};

const alertStyle = 'background:var(--bg-secondary);border-left:4px solid var(--color-warning);padding:12px;margin:16px 0;border-radius:4px;';

export function parseShortcodes(text: string | null | undefined): string {
  if (!text) return '';

  let result = text;

  // Nested form used by the admin editor, for example:
  // [alert:[red:important message]]
  result = result.replace(
    /\[alert:\[(red|orange|blue|green):([\s\S]*?)\]\]/g,
    (_match, color: string, content: string) =>
      `<div style="${alertStyle}"><span style="color:${colorStyles[color]};font-weight:600;">${content}</span></div>`
  );

  // Standard alert block. Supports line breaks.
  result = result.replace(
    /\[alert:([\s\S]*?)\]/g,
    `<div style="${alertStyle}">$1</div>`
  );

  result = result.replace(/\[red:([\s\S]*?)\]/g, '<span style="color:var(--color-danger);font-weight:600;">$1</span>');
  result = result.replace(/\[orange:([\s\S]*?)\]/g, '<span style="color:var(--color-warning);font-weight:600;">$1</span>');
  result = result.replace(/\[blue:([\s\S]*?)\]/g, '<span style="color:var(--color-primary);font-weight:600;">$1</span>');
  result = result.replace(/\[green:([\s\S]*?)\]/g, '<span style="color:var(--color-success);font-weight:600;">$1</span>');

  return result;
}
