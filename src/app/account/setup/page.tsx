'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, LockKeyhole } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { studentNumberFromEmail } from '@/lib/config';
import { safeNextPath } from '@/lib/safeNextPath';
import { useQueryParam } from '@/hooks/useQueryParam';

/**
 * 大学Googleアカウントの表示名（例: 24B123山田 太郎）から先頭の学籍番号を外した氏名。
 * 表示用。登録時の氏名は DB の create_my_profile が Google の認証情報から同じ規則で取り出す。
 */
function nameFromGoogleDisplayName(displayName: unknown, studentNumber: string): string {
  let value = String(displayName || '').trim();
  if (studentNumber && value.toUpperCase().startsWith(studentNumber)) {
    value = value.slice(studentNumber.length);
  }
  return value.replace(/[\s　]+/g, ' ').trim();
}

type Mode = 'confirm' | 'manual';

export default function AccountSetupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [googleName, setGoogleName] = useState('');
  const [mode, setMode] = useState<Mode>('confirm');
  const [name, setName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextParam = useQueryParam('next');
  const nextPath = nextParam === undefined ? '/' : safeNextPath(nextParam);

  const studentNumber = useMemo(() => studentNumberFromEmail(email), [email]);

  useEffect(() => {
    if (nextParam === undefined) return;
    const next = nextPath;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData.session;
      if (!session?.user) {
        router.replace(`/login?next=${encodeURIComponent(`/account/setup?next=${encodeURIComponent(next)}`)}`);
        return;
      }

      const accountEmail = String(session.user.email || '').trim().toLowerCase();
      const accountStudentNumber = studentNumberFromEmail(accountEmail);
      if (!accountStudentNumber) {
        await supabase.auth.signOut({ scope: 'local' });
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

      const metadata = session.user.user_metadata || {};
      const detected = nameFromGoogleDisplayName(metadata.full_name || metadata.name, accountStudentNumber);

      setEmail(accountEmail);
      setGoogleName(detected);
      setMode(detected ? 'confirm' : 'manual');
      setLoading(false);
    };

    void load();
  }, [nextParam, nextPath, router]);

  const finish = () => {
    router.replace(nextPath);
    router.refresh();
  };

  // 「合っている」: 氏名は送らず、DB側で大学Googleアカウントの名前から登録する
  const handleConfirmGoogleName = async () => {
    setError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc('create_my_profile', {});
    if (rpcError) {
      setError(`${rpcError.message || 'アカウント情報の登録に失敗しました。'} 氏名を入力して登録してください。`);
      setMode('manual');
      setSaving(false);
      return;
    }
    finish();
  };

  const handleManualSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const cleanName = name.trim().replace(/[\s　]+/g, ' ');
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

    finish();
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 64 }}><div className="loading-spinner" /></div>;
  }

  const lockNotice = (
    <div style={{ marginTop: 18, display: 'flex', alignItems: 'flex-start', gap: 8, padding: 14, borderRadius: 10, border: '1px solid var(--color-warning-border)', background: 'var(--color-warning-bg)', lineHeight: 1.65, fontSize: '0.88rem' }}>
      <LockKeyhole size={16} aria-hidden="true" style={{ marginTop: 3, flexShrink: 0 }} />
      <span>登録後、氏名は自分では変更できません。誤りがある場合は委員会の管理者へ変更を依頼してください。</span>
    </div>
  );

  return (
    <div className="glass-card" style={{ maxWidth: 560, margin: '28px auto', padding: '30px' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <BadgeCheck size={46} style={{ color: 'var(--color-primary)', marginBottom: 10 }} aria-hidden="true" />
        <h1 style={{ fontSize: '1.55rem', marginBottom: 8 }}>初回アカウント登録</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          {mode === 'confirm'
            ? '大学のGoogleアカウントから読み取った情報です。予約券に表示する氏名が正しいか確認してください。'
            : '予約券に表示する正式な氏名を入力してください。'}
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
        {mode === 'confirm' && (
          <div className="glass-card" style={{ padding: 14 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>氏名</div>
            <div style={{ marginTop: 4, fontWeight: 700, fontSize: '1.2rem' }}>{googleName}</div>
          </div>
        )}
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 18 }}>{error}</div>}

      {mode === 'confirm' ? (
        <div>
          <p style={{ fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>この氏名で合っていますか？</p>
          {lockNotice}
          <div style={{ display: 'grid', gap: 10, marginTop: 22 }}>
            <button type="button" className="btn btn-primary" onClick={handleConfirmGoogleName} disabled={saving} style={{ width: '100%' }}>
              {saving ? '登録しています...' : 'はい、この氏名で登録する'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setError(null); setMode('manual'); }}
              disabled={saving}
              style={{ width: '100%' }}
            >
              いいえ、違うので自分で入力する
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleManualSubmit}>
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

          <button type="submit" className="btn btn-primary" disabled={saving || !confirmed} style={{ width: '100%', marginTop: 22 }}>
            {saving ? '登録しています...' : 'この氏名で登録する'}
          </button>

          {googleName && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setError(null); setMode('confirm'); }}
              disabled={saving}
              style={{ width: '100%', marginTop: 10 }}
            >
              戻る（{googleName} で登録する）
            </button>
          )}
        </form>
      )}
    </div>
  );
}
