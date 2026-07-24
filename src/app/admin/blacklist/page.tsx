'use client';

export const runtime = 'edge';

import { useEffect, useMemo, useState } from 'react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

interface BlacklistEntry {
  id: string;
  student_number: string | null;
  university_email: string | null;
  reason: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  removed_at: string | null;
}

function normalizeStudentNumber(value: string): string {
  let normalized = value
    .replace(/[！-～]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .toUpperCase();

  if (normalized.startsWith('S')) normalized = normalized.slice(1);
  return normalized;
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

export default function AdminBlacklistPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');

  const loadEntries = async () => {
    try {
      setError(null);
      const { data, error: loadError } = await supabase
        .from('user_blacklist')
        .select('id, student_number, university_email, reason, active, expires_at, created_at, removed_at')
        .order('created_at', { ascending: false });

      if (loadError) throw loadError;
      setEntries((data as BlacklistEntry[]) || []);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError instanceof Error ? loadError.message : 'ブラックリストの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) void loadEntries();
  }, [authLoading, user]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!showInactive && !entry.active) return false;
      if (!query) return true;
      return (
        entry.student_number?.toLowerCase().includes(query) ||
        entry.university_email?.toLowerCase().includes(query) ||
        entry.reason.toLowerCase().includes(query)
      );
    });
  }, [entries, search, showInactive]);

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const normalizedStudentNumber = normalizeStudentNumber(studentNumber);
    const normalizedEmail = universityEmail.trim().toLowerCase();

    if (!normalizedStudentNumber && !normalizedEmail) {
      setError('学籍番号または大学メールアドレスのどちらかを入力してください。');
      return;
    }
    if (normalizedStudentNumber && !/^\d{2}[A-Z]\d{3}$/.test(normalizedStudentNumber)) {
      setError('学籍番号の形式が正しくありません。例：26P080');
      return;
    }
    if (!reason.trim()) {
      setError('登録理由を入力してください。');
      return;
    }

    setSaving(true);
    try {
      const { error: insertError } = await supabase.from('user_blacklist').insert({
        student_number: normalizedStudentNumber || null,
        university_email: normalizedEmail || null,
        reason: reason.trim(),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        active: true,
      });

      if (insertError) throw insertError;

      setStudentNumber('');
      setUniversityEmail('');
      setReason('');
      setExpiresAt('');
      await loadEntries();
    } catch (insertError) {
      console.error(insertError);
      setError(insertError instanceof Error ? insertError.message : 'ブラックリストへの登録に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (entry: BlacklistEntry) => {
    if (!confirm(`${entry.student_number || entry.university_email || '対象者'}をブラックリストから解除しますか？`)) {
      return;
    }

    const { error: updateError } = await supabase
      .from('user_blacklist')
      .update({ active: false })
      .eq('id', entry.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadEntries();
  };

  const handleReactivate = async (entry: BlacklistEntry) => {
    const { error: updateError } = await supabase
      .from('user_blacklist')
      .update({ active: true, expires_at: null })
      .eq('id', entry.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    await loadEntries();
  };

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0' }}><div className="loading-spinner" /></div>;
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div className="form-container-responsive">
          <h1 style={{ marginBottom: 20 }}>ブラックリスト管理</h1>

          {error && <div className="error-banner">⚠️ {error}</div>}

          <form onSubmit={handleAdd} className="glass-card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 16 }}>利用停止対象を登録</h2>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="blacklistStudentNumber">学籍番号</label>
                <input
                  id="blacklistStudentNumber"
                  className="form-input"
                  placeholder="例：26P080"
                  value={studentNumber}
                  onChange={(event) => setStudentNumber(event.target.value)}
                  onBlur={() => setStudentNumber(normalizeStudentNumber(studentNumber))}
                  disabled={saving}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="blacklistEmail">大学メールアドレス</label>
                <input
                  id="blacklistEmail"
                  type="email"
                  className="form-input"
                  placeholder="例：s26p080@ge.osaka-sandai.ac.jp"
                  value={universityEmail}
                  onChange={(event) => setUniversityEmail(event.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="blacklistReason">登録理由</label>
              <textarea
                id="blacklistReason"
                className="form-input"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={saving}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="blacklistExpiresAt">解除予定日時（空欄なら期限なし）</label>
              <input
                id="blacklistExpiresAt"
                type="datetime-local"
                className="form-input"
                value={expiresAt}
                onChange={(event) => setExpiresAt(event.target.value)}
                disabled={saving}
              />
            </div>

            <button className="btn btn-danger" type="submit" disabled={saving}>
              {saving ? '登録中...' : 'ブラックリストへ登録'}
            </button>
          </form>

          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>登録一覧</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  placeholder="学籍番号・メール・理由で検索"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  style={{ minWidth: 250 }}
                />
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={showInactive}
                    onChange={(event) => setShowInactive(event.target.checked)}
                  />
                  解除済みも表示
                </label>
              </div>
            </div>

            <div className="admin-table-container" style={{ marginTop: 16 }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>状態</th>
                    <th>学籍番号</th>
                    <th>大学メール</th>
                    <th>理由</th>
                    <th>登録日時</th>
                    <th>解除予定</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} style={{ opacity: entry.active ? 1 : 0.55 }}>
                      <td>{entry.active ? '利用停止中' : '解除済み'}</td>
                      <td>{entry.student_number || '-'}</td>
                      <td>{entry.university_email || '-'}</td>
                      <td style={{ whiteSpace: 'pre-wrap', minWidth: 260 }}>{entry.reason}</td>
                      <td>{formatDateTime(entry.created_at)}</td>
                      <td>{entry.expires_at ? formatDateTime(entry.expires_at) : '期限なし'}</td>
                      <td>
                        {entry.active ? (
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleDeactivate(entry)}>
                            解除
                          </button>
                        ) : (
                          <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleReactivate(entry)}>
                            再登録
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {filteredEntries.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: 20 }}>
                条件に一致する登録はありません。
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
