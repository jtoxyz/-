import { createClient } from '@supabase/supabase-js';

// [重要度: 高]
// ブラウザからSupabaseへ接続するための公開設定を環境変数から取得する。
// NEXT_PUBLIC_で始まる値は利用者側にも配信されるため、ここには匿名キー以外の秘密情報を設定しないこと。
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// [重要度: 高]
// 一般画面・管理画面で共通利用する通常権限のSupabaseクライアント。
// 実際のアクセス制御はSupabase側のRLSやRPCに依存するため、管理者権限の代用には使用しないこと。
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Creates a Supabase client with the service role key.
 * This should ONLY be called on the server side (Route Handlers, Server Actions, Pages Functions).
 * [重要度: 最高]
 * サーバー側の管理処理専用として、Service Roleキーを使うSupabaseクライアントを生成する。
 * Service RoleキーはRLSを回避できる強い権限を持つため、ブラウザ側のコードから絶対に呼び出さないこと。
 * この処理や環境変数名を変更すると、管理処理・データ削除・バックアップ等に影響する可能性がある。
 */
export function getServiceSupabase() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined. This operation requires server-side administrative access.');
  }
  
  // [重要度: 最高]
  // 管理用クライアントでは利用者セッションを端末へ保存せず、自動更新も行わない。
  // 認証状態を永続化するとService Roleキーを扱う処理の安全性に影響するため、この設定を変更しないこと。
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
