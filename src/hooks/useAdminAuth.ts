'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

// [重要度: 最高]
// 管理画面を表示する前に、Supabaseのログイン状態とadmin_users登録の両方を確認する共通フック。
// ここを変更すると管理者以外が管理画面へ進める可能性があるため、認証条件を緩めないこと。
export function useAdminAuth() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        // 1. Get current session
        // [重要度: 最高]
        // Supabase Authの現在のセッションを取得し、ログイン済みかを最初に確認する。
        // セッションがない状態で後続処理を実行しないための入口となる判定。
        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session || !session.user) {
          setUser(null);
          router.push('/admin/login');
          return;
        }

        // 2. Validate admin role
        // [重要度: 最高]
        // ログインできることと管理者であることは別のため、admin_usersテーブルで権限を再確認する。
        // この照合を削除すると、一般の認証ユーザーが管理画面へ入れる可能性がある。
        const { data: adminData, error: adminError } = await supabase
          .from('admin_users')
          .select('user_id')
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (adminError || !adminData) {
          console.warn('Unauthorized admin access attempt. Logging out.');
          // [重要度: 最高]
          // 管理者確認に失敗したセッションを残さないよう、その場でログアウトさせる。
          // setUser(null)だけではSupabase側のセッションが残るため、signOutを削除しないこと。
          await supabase.auth.signOut();
          setUser(null);
          router.push('/admin/login');
          return;
        }

        // [重要度: 高]
        // セッションと管理者登録の両方を確認できた場合のみ、管理画面で利用するユーザー情報を保持する。
        setUser(session.user);
      } catch (err) {
        console.error('Admin Auth Error:', err);
        // [重要度: 高]
        // 認証確認中に予期しないエラーが起きた場合は、安全側に倒してログイン画面へ戻す。
        router.push('/admin/login');
      } finally {
        // [重要度: 中]
        // 認証確認の成功・失敗にかかわらず読込状態を解除し、画面が読み込み中のまま止まることを防ぐ。
        setLoading(false);
      }
    }

    checkAuth();
  }, [router]);

  return { loading, user };
}