/**
 * 日本時間（Asia/Tokyo, UTC+9, 夏時間なし）での日時の変換。
 * 管理画面の <input type="date|time|datetime-local"> は端末のタイムゾーンを持たないので、
 * 端末の設定に関係なく、入力値はすべて日本時間として扱う。
 */

export const TIME_ZONE = 'Asia/Tokyo';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 文字列を、日本時間の各部分（年・月・日・時・分・曜日）に分ける */
function jstParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // 日本時間は UTC+9 固定なので、9時間進めて UTC として読めば日本時間の値になる
  const shifted = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  };
}

/** 「YYYY-MM-DD」と「HH:mm」（日本時間）→ ISO 文字列 */
export function jstDateTimeToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+09:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** datetime-local の値「YYYY-MM-DDTHH:mm」（日本時間）→ ISO 文字列 */
export function jstLocalToIso(value: string): string | null {
  if (!value) return null;
  const [date, time] = value.split('T');
  return jstDateTimeToIso(date, time || '00:00');
}

/** ISO 文字列 → datetime-local の値「YYYY-MM-DDTHH:mm」（日本時間） */
export function isoToJstLocal(value: string | null | undefined): string {
  if (!value) return '';
  const p = jstParts(value);
  if (!p) return '';
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO 文字列 → 「YYYY-MM-DD」（日本時間） */
export function isoToJstDate(value: string | null | undefined): string {
  return isoToJstLocal(value).slice(0, 10);
}

/** ISO 文字列 → 「HH:mm」（日本時間） */
export function isoToJstTime(value: string | null | undefined): string {
  return isoToJstLocal(value).slice(11, 16);
}

/** 今日の日付「YYYY-MM-DD」（日本時間） */
export function todayJst(): string {
  return isoToJstDate(new Date().toISOString());
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** datetime-local の値や ISO 文字列 → 「11/7(土) 14:00」（日本時間） */
export function formatJstShort(value: string | null | undefined): string {
  if (!value) return '未設定';
  const iso = /T\d{2}:\d{2}$/.test(value) ? jstLocalToIso(value) : value;
  if (!iso) return '未設定';
  const p = jstParts(iso);
  if (!p) return '未設定';
  return `${p.month}/${p.day}(${WEEKDAYS[p.weekday]}) ${pad(p.hour)}:${pad(p.minute)}`;
}

/** 表示用の日時（例: 11/7(土) 14:00）。Intl で Asia/Tokyo を明示する */
export function formatJstDateTime(value: string | null | undefined, empty = '未設定'): string {
  if (!value) return empty;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return empty;
  return date.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TIME_ZONE,
  });
}
