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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Sign in with email and password
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setError(authError.message || 'ログインに失敗しました。');
        setLoading(false);
        return;
      }

      if (!authData.user) {
        setError('ユーザー情報が取得できませんでした。');
        setLoading(false);
        return;
      }

      // 2. Verify if user is an admin by querying the admin_users table
      const { data: adminData, error: adminError } = await supabase
        .from('admin_users')
        .select('user_id')
        .eq('user_id', authData.user.id)
        .maybeSingle();

      if (adminError) {
        console.error('Error verifying admin status:', adminError);
        setError('管理者情報の検証中にエラーが発生しました。');
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      if (!adminData) {
        setError('このアカウントには管理者権限がありません。');
        // Sign out immediately to clear session
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      // Success: Redirect to admin dashboard
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
