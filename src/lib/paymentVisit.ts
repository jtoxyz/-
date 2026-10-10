import { supabase } from '@/lib/supabase';

export type PaymentVisitSlot = {
  id: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  is_active: boolean;
};

const TIME_ZONE = 'Asia/Tokyo';

/** 例: 10/5(日) 12:30〜13:00（日付をまたぐ場合は終了側にも日付を付ける） */
export function formatVisitSlot(slot: Pick<PaymentVisitSlot, 'starts_at' | 'ends_at'>): string {
  const day = (value: string) =>
    new Date(value).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: TIME_ZONE });
  const time = (value: string) =>
    new Date(value).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: TIME_ZONE });
  const sameDay = day(slot.starts_at) === day(slot.ends_at);
  return `${day(slot.starts_at)} ${time(slot.starts_at)}〜${sameDay ? '' : `${day(slot.ends_at)} `}${time(slot.ends_at)}`;
}

/** JST の日付文字列 (YYYY-MM-DD) */
export function jstDateKey(value: string | Date): string {
  return new Date(value).toLocaleDateString('sv-SE', { timeZone: TIME_ZONE });
}

/** 予約日（JST）から見て選べる来室枠に絞る。DB の resolve_payment_visit_slot と同じ基準。
 *  windowDays = 0 は当日のみ。N >= 1 は当日＋翌日以降で受付枠がある日を N 日分（土日祝など枠がない日は数えない）。
 *  null は制限なし。翌日以降の受付日が N 日分に満たない場合はすべて選べる。 */
export function filterVisitSlotsByWindow<T extends Pick<PaymentVisitSlot, 'starts_at'>>(
  slots: T[],
  windowDays: number | null | undefined,
  now = new Date(),
): T[] {
  if (windowDays === null || windowDays === undefined) return slots;
  const today = jstDateKey(now);
  let limitDate = today;
  if (windowDays > 0) {
    const laterDates = [...new Set(slots.map((slot) => jstDateKey(slot.starts_at)).filter((d) => d > today))].sort();
    if (laterDates.length < windowDays) return slots;
    limitDate = laterDates[windowDays - 1];
  }
  return slots.filter((slot) => jstDateKey(slot.starts_at) <= limitDate);
}

export const VISIT_WINDOW_OPTIONS: { value: number | null; label: string }[] = [
  { value: 0, label: '予約した日のうち' },
  { value: 1, label: '次の受付日まで（土日祝など枠のない日は飛ばす）' },
  { value: 2, label: '2つ先の受付日まで' },
  { value: 3, label: '3つ先の受付日まで' },
  { value: 7, label: '7つ先の受付日まで' },
  { value: null, label: '制限なし' },
];

/** 予約画面で学生に見せる範囲の説明 */
export function visitWindowNotice(windowDays: number | null | undefined): string {
  if (windowDays === null || windowDays === undefined) return '';
  if (windowDays === 0) return '選べるのは今日の日時だけです。';
  const next = windowDays === 1 ? '次の受付日' : `${windowDays}つ先の受付日`;
  return `選べるのは今日から${next}までの日時です（土日祝など受付のない日は数えません）。`;
}

/** 予約で選べる来室枠（有効・終了前・選択範囲内）を開始順に取得する */
export async function fetchSelectableVisitSlots(windowDays: number | null = null): Promise<PaymentVisitSlot[]> {
  const { data, error } = await supabase
    .from('payment_visit_slots')
    .select('id,starts_at,ends_at,note,is_active')
    .eq('is_active', true)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return filterVisitSlotsByWindow((data as PaymentVisitSlot[]) || [], windowDays);
}

/** 自分の予約に紐づく来室枠を reservation_id ごとに取得する */
export async function fetchMyVisitSlots(reservationIds: string[]): Promise<Record<string, PaymentVisitSlot>> {
  if (reservationIds.length === 0) return {};
  const { data, error } = await supabase
    .from('reservations')
    .select('id,payment_visit_slots(id,starts_at,ends_at,note,is_active)')
    .in('id', reservationIds)
    .not('payment_visit_slot_id', 'is', null);
  if (error) return {};
  const map: Record<string, PaymentVisitSlot> = {};
  for (const row of (data as unknown as { id: string; payment_visit_slots: PaymentVisitSlot | null }[]) || []) {
    if (row.payment_visit_slots) map[row.id] = row.payment_visit_slots;
  }
  return map;
}
