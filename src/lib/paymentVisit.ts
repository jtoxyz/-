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

/** 予約で選べる来室枠（有効かつ終了前）を開始順に取得する */
export async function fetchSelectableVisitSlots(): Promise<PaymentVisitSlot[]> {
  const { data, error } = await supabase
    .from('payment_visit_slots')
    .select('id,starts_at,ends_at,note,is_active')
    .eq('is_active', true)
    .gt('ends_at', new Date().toISOString())
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data as PaymentVisitSlot[]) || [];
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
