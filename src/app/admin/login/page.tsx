'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // [重要度: 最高]
  // 管理画面へ入る前に、Supabase Authの認証とadmin_usersテーブルの権限確認を順番に行う。
  // 認証成功だけでは管理者とは限らないため、後半の管理者確認を省略・変更しないこと。
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Sign in with email and password
      // [重要度: 最高]
      // 入力されたメールアドレスとパスワードでSupabase Authへログインする。
      // ここでは本人認証のみを行い、管理者権限の有無はまだ確定していない。
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message || 'ログインに失敗しました。');
        setLoading(false);
        return;
      }

      // [重要度: 最高]
      // 認証応答にユーザー情報がない場合は、後続の権限確認を行わず処理を中断する。
      if (!authData.user) {
        setError('ユーザー情報が取得できませんでした。');
        setLoading(false);
        return;
      }

      // 2. Verify if user is an admin by querying the admin_users table
      // [重要度: 最高]
      // 認証済みユーザーのIDがadmin_usersテーブルに登録されているか確認する。
      // この照合が管理画面への最終的な権限判定になるため、テーブル名・user_id条件を変更すると
      // 管理者が入れなくなる、または一般ユーザーが管理画面へ入れる危険がある。
      const { data: adminData, error: adminError } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', authData.user.id)
        .maybeSingle();

      if (adminError) {
        console.error('Error verifying admin status:', adminError);
        setError('管理者情報の検証中にエラーが発生しました。');

        // [重要度: 最高]
        // 権限確認に失敗した状態のセッションを残さないよう、直ちにログアウトする。
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      if (!adminData) {
        setError('このアカウントには管理者権限がありません。');

        // Sign out immediately to clear session
        // [重要度: 最高]
        // 認証自体が成功していても管理者登録がなければセッションを破棄する。
        // このログアウトを削除すると、権限のない認証セッションが端末に残る可能性がある。
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      // Success: Redirect to admin dashboard
      // [重要度: 高]
      // 認証と管理者確認の両方が成功した場合だけ、管理画面の企画一覧へ移動する。
      router.push('/admin/events');
    } catch (err) {
      console.error('Login error:', err);
      setError('予期しないエラーが発生しました。');
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          ← 一般公開サイトに戻る
        </Link>
      </div>

      <div className="glass-card" style={{ maxWidth: '400px', margin: '40px auto 0 auto', borderTop: '4px solid var(--color-danger)' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '8px', color: 'var(--text-primary)', textAlign: 'center' }}>
          管理者ログイン
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', marginBottom: '24px' }}>
          委員会スタッフ専用ログインページです。
        </p>

        {error && (
          <div className="error-banner">
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label" htmlFor="email">メールアドレス</label>
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">パスワード</label>
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div style={{ marginTop: '30px' }}>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={loading}
            >
              {loading ? '認証中...' : '管理者ログイン'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
