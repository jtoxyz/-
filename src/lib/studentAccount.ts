export type StudentProfile = {
  student_name: string;
  student_number: string;
  university_email: string;
};

export type AccountEvent = {
  id: string;
  title: string;
  description: string | null;
  slot_selection_mode: 'single' | 'multiple';
};

export type AccountEventSlot = {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  reservation_status: string;
  walkin_status: string;
  is_enabled: boolean;
  is_reservation_enabled: boolean;
  is_walkin_enabled: boolean;
  remaining_reservation_slots?: number | null;
  remaining_walkin_slots?: number | null;
};

export function formatAccountDate(value: string | null): string {
  if (!value) return '日時未設定';
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

export function canReserveSlot(slot: AccountEventSlot): boolean {
  return slot.is_enabled && slot.is_reservation_enabled && ['available', 'low_remaining'].includes(slot.reservation_status);
}

export function canGetWalkinSlot(slot: AccountEventSlot): boolean {
  return slot.is_enabled && slot.is_walkin_enabled && ['walkin_available', 'walkin_low_remaining'].includes(slot.walkin_status);
}

export function accountSlotStatus(slot: AccountEventSlot): string {
  if (canReserveSlot(slot)) return slot.reservation_status === 'low_remaining' ? '予約：残りわずか' : '予約受付中';
  if (canGetWalkinSlot(slot)) return slot.walkin_status === 'walkin_low_remaining' ? '当日券：残りわずか' : '当日券受付中';
  if (slot.reservation_status === 'before_open') return '予約受付前';
  if (slot.walkin_status === 'walkin_upcoming') return '当日券受付前';
  if (slot.reservation_status === 'full' || slot.walkin_status === 'walkin_full') return '満席';
  return '受付終了';
}
