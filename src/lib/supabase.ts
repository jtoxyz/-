import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * スマホアプリ（がっけんぽアプリ）の中でGoogleログインするときだけ使うクライアント。
 * Googleはアプリの中の画面でのログインを禁止しているので、ログインはスマホのブラウザで行い、
 * 戻ってきた「コード」をアプリの中でログイン状態に換える（PKCE。src/lib/nativeApp.ts）。
 * ここで得たログイン状態は、学生用クライアント（supabase）に setSession で移す。
 */
export const appOAuthSupabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'pkce',
    storageKey: 'sb-committee-app-oauth',
    detectSessionInUrl: false,
  },
});

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
