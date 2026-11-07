import type { SupabaseClient } from '@supabase/supabase-js';

/** 支払いQRの RPC。画面（管理者・スタッフ）ごとに使う関数を分ける。effect の依存が変わらないよう関数を作り直さない */

export const adminLaneQr = (client: SupabaseClient) => (eventId: string, lane: string) =>
  client.rpc('admin_get_lane_payment_qr', { p_event_id: eventId, p_lane: lane });

export const staffLaneQr = (client: SupabaseClient) => (eventId: string, lane: string) =>
  client.rpc('staff_get_lane_payment_qr', { p_event_id: eventId, p_lane: lane });

/** 管理者：発行するたびに新しいQR（同じ日の古いQRは無効） */
export const adminIssueDailyQr = (client: SupabaseClient) => (eventId: string, validDate: string) =>
  client.rpc('admin_create_payment_qr', {
    p_event_id: eventId,
    p_mode: 'daily',
    p_valid_date: validDate,
    p_dynamic_seconds: 90,
  });

/** スタッフ：その日のQRがあればそれを返す。reissue のときだけ作り直す */
export const staffDailyQr = (client: SupabaseClient) => (eventId: string, validDate: string, reissue: boolean) =>
  client.rpc('staff_get_daily_payment_qr', {
    p_event_id: eventId,
    p_valid_date: validDate,
    p_reissue: reissue,
  });
