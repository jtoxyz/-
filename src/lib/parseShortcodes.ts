export function parseShortcodes(text: string | null | undefined): string {
  if (!text) return '';

  let result = text;

  // Parse block shortcodes first so nested color shortcodes remain available.
  result = result.replace(
    /\[alert:([\s\S]*?)\]\]/g,
    '<div style="background:var(--bg-secondary);border-left:4px solid var(--color-warning);padding:12px;margin:16px 0;border-radius:4px;">$1</div>'
  );

  // Backward compatibility for non-nested, single-closing-bracket alerts.
  result = result.replace(
    /\[alert:([\s\S]*?)\]/g,
    '<div style="background:var(--bg-secondary);border-left:4px solid var(--color-warning);padding:12px;margin:16px 0;border-radius:4px;">$1</div>'
  );

  result = result.replace(/\[red:([\s\S]*?)\]/g, '<span style="color:var(--color-danger);font-weight:600;">$1</span>');
  result = result.replace(/\[orange:([\s\S]*?)\]/g, '<span style="color:var(--color-warning);font-weight:600;">$1</span>');
  result = result.replace(/\[blue:([\s\S]*?)\]/g, '<span style="color:var(--color-primary);font-weight:600;">$1</span>');
  result = result.replace(/\[green:([\s\S]*?)\]/g, '<span style="color:var(--color-success);font-weight:600;">$1</span>');

  return result;
}
