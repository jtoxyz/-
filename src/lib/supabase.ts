import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * 管理画面専用のクライアント。ログイン状態を学生用とは別のキーに保存するので、
 * 同じブラウザで管理者アカウントと大学アカウントに同時にログインできる。
 * 学生のGoogleログインの戻りURLは学生用クライアントだけが読む（detectSessionInUrl: false）。
 */
export const adminSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'sb-committee-admin-auth',
    detectSessionInUrl: false,
  },
});
