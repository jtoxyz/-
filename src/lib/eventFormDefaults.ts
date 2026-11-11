/** 企画作成・編集フォームの標準値。任意設定のチェックを外したときはこの値で保存する。 */
export const DEFAULT_ALLOWED_DOMAINS = 'ge.osaka-sandai.ac.jp';
export const DEFAULT_LOW_REMAINING_THRESHOLD = 10;
export const DEFAULT_LOW_REMAINING_THRESHOLD_TYPE = 'count' as const;

/** YYYY-MM-DD / datetime-local 文字列の日付部分を days 日ずらす（時刻はそのまま）。空なら空のまま。 */
export function shiftLocalDate(value: string, days: number): string {
  if (!value) return value;
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  const pad = (n: number) => String(n).padStart(2, '0');
  const nextDate = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  return timePart !== undefined ? `${nextDate}T${timePart}` : nextDate;
}

/** 開催枠を翌日にずらしたコピー用の値（開催日・チケット使用・当日券の日時をまとめて1日後へ） */
export function shiftSlotTimingByDays<T extends {
  date: string;
  ticketUseStartsAt: string;
  ticketUseEndsAt: string;
  walkinStartsAt: string;
  walkinEndsAt: string;
}>(row: T, days: number): T {
  return {
    ...row,
    date: shiftLocalDate(row.date, days),
    ticketUseStartsAt: shiftLocalDate(row.ticketUseStartsAt, days),
    ticketUseEndsAt: shiftLocalDate(row.ticketUseEndsAt, days),
    walkinStartsAt: shiftLocalDate(row.walkinStartsAt, days),
    walkinEndsAt: shiftLocalDate(row.walkinEndsAt, days),
  };
}
