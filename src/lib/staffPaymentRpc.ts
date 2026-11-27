import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FindResult,
  PaymentConfirmMode,
  PaymentSummary,
  ReceiveResult,
  UndoResult,
} from '@/lib/staffPaymentScan';

/** 受付（スタッフ確認方式）の支払いRPC。失敗は例外にせず error 文字列で返す */
export type RpcResult<T> = { data: T; error: null } | { data: null; error: string };

async function call<T>(
  client: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<RpcResult<T>> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { data: null, error: error.message };
  return { data: data as T, error: null };
}

export const findPaymentTarget = (client: SupabaseClient, eventId: string | null, query: string) =>
  call<FindResult>(client, 'staff_find_payment_target', { p_event_id: eventId, p_query: query });

export const receivePayment = (client: SupabaseClient, reservationIds: string[]) =>
  call<ReceiveResult>(client, 'staff_receive_payment', { p_reservation_ids: reservationIds });

export const undoPayment = (client: SupabaseClient, reservationId: string) =>
  call<UndoResult>(client, 'staff_undo_payment', { p_reservation_id: reservationId });

export const getPaymentSummary = (client: SupabaseClient, eventId: string, date?: string) =>
  call<PaymentSummary>(client, 'staff_get_payment_summary', {
    p_event_id: eventId,
    ...(date ? { p_date: date } : {}),
  });

/** 企画ごとの確認方式。エラー時・RPCがない時は {}（呼び出し側は無い企画を 'student_scan' とみなす） */
export async function getPaymentConfirmModes(
  client: SupabaseClient,
  eventIds: string[],
): Promise<Record<string, PaymentConfirmMode>> {
  if (eventIds.length === 0) return {};
  try {
    const { data, error } = await client.rpc('get_event_payment_confirm_modes', { p_event_ids: eventIds });
    if (error || !Array.isArray(data)) return {};
    const modes: Record<string, PaymentConfirmMode> = {};
    for (const row of data as { event_id: string; payment_confirm_mode: PaymentConfirmMode }[]) {
      modes[row.event_id] = row.payment_confirm_mode;
    }
    return modes;
  } catch {
    return {};
  }
}
