/**
 * 開催枠フォームの「チケット使用可能期間」「当日券発行期間」を開催日・開始時刻・終了時刻から自動で決める。
 * 自動で入った値は開催日や時刻を変えると追従し、管理者が手で変えた値はそのまま残す。
 */

type SlotTimingFields = {
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  ticketUseStartsAt: string; // datetime-local
  ticketUseEndsAt: string;
  walkinStartsAt: string;
  walkinEndsAt: string;
};

type DerivedField = 'ticketUseStartsAt' | 'ticketUseEndsAt' | 'walkinStartsAt' | 'walkinEndsAt';

const DERIVED_FIELDS: DerivedField[] = ['ticketUseStartsAt', 'ticketUseEndsAt', 'walkinStartsAt', 'walkinEndsAt'];
const SOURCE_FIELDS = ['date', 'startTime', 'endTime'];

export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function derivedTiming(row: SlotTimingFields): Record<DerivedField, string> {
  const at = (time: string, offset = 0) => (row.date && time ? `${row.date}T${addMinutesToTime(time, offset)}` : '');
  return {
    // チケット使用：開催枠の開始〜終了
    ticketUseStartsAt: at(row.startTime),
    ticketUseEndsAt: at(row.endTime),
    // 当日券：開始30分前〜終了30分前
    walkinStartsAt: at(row.startTime, -30),
    walkinEndsAt: at(row.endTime, -30),
  };
}

/** 1項目を変更した後の行を返す。開催日・時刻の変更なら、自動入力のままの期間を新しい値に合わせ直す。 */
export function applySlotTimingChange<T extends SlotTimingFields>(row: T, field: keyof T, value: T[keyof T]): T {
  const updated: T = { ...row, [field]: value };
  if (!SOURCE_FIELDS.includes(field as string)) return updated;

  const timing: SlotTimingFields = updated;
  if (field === 'date' && value) {
    if (!timing.startTime) timing.startTime = '11:00';
    if (!timing.endTime) timing.endTime = '14:00';
  }

  const before = derivedTiming(row);
  const after = derivedTiming(timing);
  for (const key of DERIVED_FIELDS) {
    const followsAuto = !row[key] || row[key] === before[key];
    if (followsAuto && after[key]) timing[key] = after[key];
  }
  return updated;
}
