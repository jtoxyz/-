'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, LockKeyhole } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function studentNumberFromEmail(email: string): string {
  const match = email.match(/^s([0-9]{2}[a-z][0-9]{3})@ge\.osaka-sandai\.ac\.jp$/i);
  return match ? match[1].toUpperCase() : '';
}

export default function AccountSetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState('/');

  const studentNumber = useMemo(() => studentNumberFromEmail(email), [email]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next = safeNextPath(params.get('next'));
    setNextPath(next);

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session?.user) {
        router.replace(`/login?next=${encodeURIComponent(`/account/setup?next=${encodeURIComponent(next)}`)}`);
        return;
      }

      const accountEmail = String(session.user.email || '').trim().toLowerCase();
      if (!studentNumberFromEmail(accountEmail)) {
        await supabase.auth.signOut();
        router.replace('/login?reason=university-account');
        return;
      }

      const { data: existing } = await supabase
        .from('user_profiles')
        .select('user_id')
        .eq('user_id', session.user.id)
        .maybeSingle();

      if (existing) {
        router.replace(next);
        return;
      }

      setEmail(accountEmail);
      setLoading(false);
    };

    void load();
  }, [router]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setError('正式な氏名を入力してください。');
      return;
    }
    if (!confirmed) {
      setError('登録後は自分で変更できないことを確認してください。');
      return;
    }

    setSaving(true);
    const { error: rpcError } = await supabase.rpc('create_my_profile', {
      p_student_name: cleanName,
    });

    if (rpcError) {
      setError(rpcError.message || 'アカウント情報の登録に失敗しました。');
      setSaving(false);
      return;
    }

    router.replace(nextPath);
    router.refresh();
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64 }}><div className="loading-spinner" /></div>;
  }

  return (
    <div className="glass-card" style={{ maxWidth: 560, margin: '28px auto', padding: '30px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <BadgeCheck size={46} style={{ color: 'var(--color-primary)', marginBottom: 10 }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.55rem', marginBottom: 8 }}>初回アカウント登録</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          予約券に表示する正式な氏名を登録してください。
        </p>
      </div>

      <div style={{ display: 'grid', gap: 12, marginBottom: 22 }}>
        <div className="glass-card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>大学メール</div>
          <div style={{ marginTop: 4, fontWeight: 700, wordBreak: 'break-all' }}>{email}</div>
        </div>
        <div className="glass-card" style={{ padding: 14 }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>学籍番号</div>
          <div style={{ marginTop: 4, fontWeight: 700 }}>{studentNumber}</div>
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 18 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label" htmlFor="studentName">正式な氏名</label>
          <input
            id="studentName"
            className="form-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例：山田 太郎"
            maxLength={100}
            autoComplete="name"
            disabled={saving}
            required
          />
          <span className="form-hint">予約券・管理者画面に表示される氏名です。</span>
        </div>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 18, padding: 14, borderRadius: 10, border: '1px solid var(--color-warning-border)', background: 'var(--color-warning-bg)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={saving}
            style={{ marginTop: 3 }}
          />
          <span style={{ lineHeight: 1.65, fontSize: '0.88rem' }}>
            登録後、氏名は自分では変更できません。誤りがある場合は委員会の管理者へ変更を依頼します。
          </span>
        </label>

        <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
          <LockKeyhole size={16} aria-hidden="true" />
          氏名変更は管理者画面からのみ実行できます。
        </div>

        <button type="submit" className="btn btn-primary" disabled={saving || !confirmed} style={{ width: '100%', marginTop: 22 }}>
          {saving ? '登録しています...' : 'この氏名で登録する'}
        </button>
      </form>
    </div>
  );
}
