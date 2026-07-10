export function parseShortcodes(text: string | null | undefined): string {
  if (!text) return '';
  let result = text;
  
  result = result.replace(/\[red:(.*?)\]/g, '<span style="color:var(--color-danger);font-weight:600;">$1</span>');
  result = result.replace(/\[orange:(.*?)\]/g, '<span style="color:var(--color-warning);font-weight:600;">$1</span>');
  result = result.replace(/\[blue:(.*?)\]/g, '<span style="color:var(--color-primary);font-weight:600;">$1</span>');
  result = result.replace(/\[green:(.*?)\]/g, '<span style="color:var(--color-success);font-weight:600;">$1</span>');
  result = result.replace(/\[alert:(.*?)\]/g, '<div style="background:var(--bg-secondary);border-left:4px solid var(--color-warning);padding:12px;margin:16px 0;border-radius:4px;">$1</div>');
  
  return result;
}
