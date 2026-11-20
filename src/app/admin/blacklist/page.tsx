'use client';

import { useMemo, useState } from 'react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { adminSupabase as supabase } from '@/lib/supabase';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { TriangleAlert } from 'lucide-react';

interface BlacklistEntry {
  id: string;
  student_number: string | null;
  university_email: string | null;
  reason: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  removed_at: string | null;
  noshow_count_at_removal: number | null;
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

// 手動で登録したイエローリスト（user_yellowlist）
interface YellowlistEntry {
  id: string;
  student_number: string | null;
  university_email: string | null;
  reason: string;
  active: boolean;
  expires_at: string | null;
  created_at: string;
  removed_at: string | null;
}

type ListType = 'black' | 'yellow';

const LIST_LABEL: Record<ListType, string> = { black: 'ブラックリスト', yellow: 'イエローリスト' };

type NoShowUser = {
  student_number: string;
  student_name: string | null;
  university_email: string | null;
  noshow_count: number;
  last_noshow_at: string | null;
  is_blacklisted: boolean;
};

// ブラックリスト行に表示する氏名・来なかった回数（予約履歴から算出）
type BlacklistPersonInfo = {
  student_name: string | null;
  noshow_count: number;
  last_noshow_at: string | null;
};

type ReservationNoShowRow = {
  student_number: string | null;
  student_name: string | null;
  status: string;
  payment_status: string | null;
  cancelled_at: string | null;
  payment_due_at: string | null;
  created_at: string;
};

export default function AdminBlacklistPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [entries, setEntries] = useState<BlacklistEntry[]>([]);
  const [yellowEntries, setYellowEntries] = useState<YellowlistEntry[]>([]);
  const [showInactiveYellow, setShowInactiveYellow] = useState(false);
  const [listType, setListType] = useState<ListType>('black');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState('');
  const [noShowUsers, setNoShowUsers] = useState<NoShowUser[]>([]);
  const [personInfo, setPersonInfo] = useState<Record<string, BlacklistPersonInfo>>({});

  // ブラックリストの学籍番号ごとに、氏名と（最後の解除以降の）来なかった回数を予約履歴から集計する
  const loadPersonInfo = async (list: BlacklistEntry[]) => {
    const studentNumbers = Array.from(
      new Set(list.map((entry) => entry.student_number).filter((value): value is string => !!value)),
    );
    if (studentNumbers.length === 0) {
      setPersonInfo({});
      return;
    }

    const { data, error: loadError } = await supabase
      .from('reservations')
      .select('student_number, student_name, status, payment_status, cancelled_at, payment_due_at, created_at')
      .in('student_number', studentNumbers);

    if (loadError) {
      console.error(loadError);
      return;
    }

    const lastRemovedAt: Record<string, number> = {};
    for (const entry of list) {
      if (!entry.student_number || !entry.removed_at) continue;
      const removed = new Date(entry.removed_at).getTime();
      lastRemovedAt[entry.student_number] = Math.max(lastRemovedAt[entry.student_number] ?? -Infinity, removed);
    }

    const info: Record<string, BlacklistPersonInfo & { name_at: number }> = {};
    for (const row of (data as ReservationNoShowRow[]) || []) {
      if (!row.student_number) continue;
      const current = info[row.student_number] ?? { student_name: null, noshow_count: 0, last_noshow_at: null, name_at: -Infinity };
      const createdAt = new Date(row.created_at).getTime();
      if (row.student_name && createdAt > current.name_at) {
        current.student_name = row.student_name;
        current.name_at = createdAt;
      }
      const noShowAt = row.cancelled_at ?? row.payment_due_at;
      if (
        row.status === 'cancelled' &&
        row.payment_status === 'expired' &&
        noShowAt &&
        new Date(noShowAt).getTime() > (lastRemovedAt[row.student_number] ?? -Infinity)
      ) {
        current.noshow_count += 1;
        if (!current.last_noshow_at || new Date(noShowAt) > new Date(current.last_noshow_at)) {
          current.last_noshow_at = noShowAt;
        }
      }
      info[row.student_number] = current;
    }
    setPersonInfo(info);
  };

  // 支払いに2回以上来なかった人（2回：イエローリスト、3回で自動的にブラックリスト）
  const loadNoShowUsers = async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_list_noshow_users');
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setNoShowUsers((data as NoShowUser[]) || []);
  };

  const loadYellowEntries = async () => {
    const { data, error: loadError } = await supabase
      .from('user_yellowlist')
      .select('id, student_number, university_email, reason, active, expires_at, created_at, removed_at')
      .order('created_at', { ascending: false });
    if (loadError) {
      console.error(loadError);
      setError(loadError.message);
      return;
    }
    setYellowEntries((data as YellowlistEntry[]) || []);
  };

  const reloadAll = () => Promise.all([loadEntries(), loadYellowEntries(), loadNoShowUsers()]);

  const loadEntries = async () => {
    try {
      setError(null);
      const { data, error: loadError } = await supabase
        .from('user_blacklist')
        .select('id, student_number, university_email, reason, active, expires_at, created_at, removed_at, noshow_count_at_removal')
        .order('created_at', { ascending: false });

      if (loadError) throw loadError;
      const list = (data as BlacklistEntry[]) || [];
      setEntries(list);
      void loadPersonInfo(list);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError instanceof Error ? loadError.message : 'ブラックリストの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  useLoadEffect(() => {
    if (!authLoading && user) {
      void reloadAll();
    }
  }, [authLoading, user]);

  const filteredEntries = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (!showInactive && !entry.active) return false;
      if (!query) return true;
      const name = entry.student_number ? personInfo[entry.student_number]?.student_name : null;
      return (
        name?.toLowerCase().includes(query) ||
        entry.student_number?.toLowerCase().includes(query) ||
        entry.university_email?.toLowerCase().includes(query) ||
        entry.reason.toLowerCase().includes(query)
      );
    });
  }, [entries, search, showInactive, personInfo]);

  // ブラックリスト登録中の人は上のブラックリストに出るので、イエローリストには出さない
  const yellowUsers = useMemo(() => noShowUsers.filter((row) => !row.is_blacklisted), [noShowUsers]);

  // 手動で登録したイエローリストの学籍番号・メール（自動の一覧と重複して出さないため）
  const manualYellowKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of yellowEntries) {
      if (!entry.active) continue;
      if (entry.student_number) keys.add(entry.student_number);
      if (entry.university_email) keys.add(entry.university_email);
    }
    return keys;
  }, [yellowEntries]);

  const autoYellowUsers = useMemo(
    () => yellowUsers.filter((row) => !manualYellowKeys.has(row.student_number) && !(row.university_email && manualYellowKeys.has(row.university_email))),
    [yellowUsers, manualYellowKeys],
  );

  const noShowByStudent = useMemo(() => {
    const map: Record<string, NoShowUser> = {};
    for (const row of noShowUsers) map[row.student_number] = row;
    return map;
  }, [noShowUsers]);

  const visibleYellowEntries = useMemo(
    () => yellowEntries.filter((entry) => showInactiveYellow || entry.active),
    [yellowEntries, showInactiveYellow],
  );

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
      const table = listType === 'yellow' ? 'user_yellowlist' : 'user_blacklist';
      const { error: insertError } = await supabase.from(table).insert({
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
      await reloadAll();
    } catch (insertError) {
      console.error(insertError);
      const message = insertError instanceof Error ? insertError.message : '';
      setError(
        message.includes('duplicate key')
          ? `この人はすでに${LIST_LABEL[listType]}に登録されています。`
          : message || `${LIST_LABEL[listType]}への登録に失敗しました。`,
      );
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

    await reloadAll();
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

    await reloadAll();
  };

  const handleYellowDeactivate = async (entry: YellowlistEntry) => {
    if (!confirm(`${entry.student_number || entry.university_email || '対象者'}をイエローリストから解除しますか？`)) {
      return;
    }
    const { error: updateError } = await supabase.from('user_yellowlist').update({ active: false }).eq('id', entry.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await reloadAll();
  };

  const handleYellowReactivate = async (entry: YellowlistEntry) => {
    const { error: updateError } = await supabase
      .from('user_yellowlist')
      .update({ active: true, expires_at: null })
      .eq('id', entry.id);
    if (updateError) {
      setError(updateError.message.includes('duplicate key') ? 'この人はすでにイエローリストに登録されています。' : updateError.message);
      return;
    }
    await reloadAll();
  };

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0' }}><div className="loading-spinner" /></div>;
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div className="form-container-responsive">
          <h1 style={{ marginBottom: 20 }}>ブラックリスト・イエローリスト管理</h1>

          {error && <div className="error-banner" role="alert"><TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} /><span>{error}</span></div>}

          <div className="glass-card" style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>ブラックリスト（利用停止中の人）</h2>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <input
                  className="form-input"
                  placeholder="氏名・学籍番号・メール・理由で検索"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  style={{ flex: '1 1 250px', minWidth: 0 }}
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
              <table className="admin-table admin-table-stack">
                <thead>
                  <tr>
                    <th>状態</th>
                    <th>氏名</th>
                    <th>学籍番号</th>
                    <th>来なかった回数</th>
                    <th>最後に来なかった日時</th>
                    <th>理由</th>
                    <th>解除予定</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => {
                    const info = entry.student_number ? personInfo[entry.student_number] : undefined;
                    return (
                      <tr key={entry.id} style={{ opacity: entry.active ? 1 : 0.55 }}>
                        <td data-label="状態">
                          <strong>{entry.active ? 'ブラックリスト' : '解除済み'}</strong>
                          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>登録 {formatDateTime(entry.created_at)}</span>
                          {!entry.active && entry.removed_at && (
                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>解除 {formatDateTime(entry.removed_at)}</span>
                          )}
                        </td>
                        <td data-label="氏名">{info?.student_name || '-'}</td>
                        <td data-label="学籍番号">
                          {entry.student_number || '-'}
                          {entry.university_email && <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{entry.university_email}</span>}
                        </td>
                        <td data-label="来なかった回数">
                          {entry.active
                            ? `${info?.noshow_count ?? 0}回`
                            : entry.noshow_count_at_removal !== null
                              ? `解除時 ${entry.noshow_count_at_removal}回（0回にリセット済み）`
                              : '-'}
                        </td>
                        <td data-label="最後に来なかった日時">{entry.active ? formatDateTime(info?.last_noshow_at ?? null) : '-'}</td>
                        <td data-label="理由" style={{ whiteSpace: 'pre-wrap', minWidth: 220 }}>{entry.reason}</td>
                        <td data-label="解除予定">{entry.expires_at ? formatDateTime(entry.expires_at) : '期限なし'}</td>
                        <td className="admin-table-stack-actions">
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
                    );
                  })}
                </tbody>
              </table>
            </div>

            {filteredEntries.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: 20 }}>
                条件に一致する登録はありません。
              </p>
            )}
          </div>

          <form onSubmit={handleAdd} className="glass-card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: 16 }}>リストに登録</h2>

            <div className="form-group">
              <span className="form-label" id="listTypeLabel">登録先</span>
              <div role="radiogroup" aria-labelledby="listTypeLabel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(['black', 'yellow'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={listType === type}
                    className={`btn btn-sm ${listType === type ? (type === 'black' ? 'btn-danger' : 'btn-primary') : 'btn-secondary'}`}
                    onClick={() => setListType(type)}
                    disabled={saving}
                  >
                    {LIST_LABEL[type]}
                  </button>
                ))}
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: '6px 0 0', lineHeight: 1.6 }}>
                {listType === 'black'
                  ? 'ブラックリスト：予約サイトを利用できなくなります。'
                  : 'イエローリスト：本人の予約サイトに警告が出ます。登録中に支払いに来なかった場合は、自動的にブラックリストへ登録されます。'}
              </p>
            </div>

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

            <button className={`btn ${listType === 'black' ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={saving}>
              {saving ? '登録中...' : `${LIST_LABEL[listType]}へ登録`}
            </button>
          </form>

          <div className="glass-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>イエローリスト（警告中の人）</h2>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={showInactiveYellow}
                  onChange={(event) => setShowInactiveYellow(event.target.checked)}
                />
                解除済みも表示
              </label>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0, lineHeight: 1.7 }}>
              「手動登録」は上のフォームで登録した人です。登録中に支払いに来なかった場合は自動的にブラックリストへ登録されます。
              「自動」は予約した支払い日時に来ず、自動キャンセルになった回数（全企画）が2回になった人です。3回目で自動的にブラックリストへ登録されます。ブラックリストを解除すると回数は0に戻ります（解除前の回数は、上のブラックリストで「解除済みも表示」にすると確認できます）。
            </p>
            <div className="admin-table-container">
              <table className="admin-table admin-table-stack">
                <thead>
                  <tr>
                    <th>状態</th>
                    <th>氏名</th>
                    <th>学籍番号</th>
                    <th>来なかった回数</th>
                    <th>最後に来なかった日時</th>
                    <th>理由</th>
                    <th>解除予定</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleYellowEntries.map((entry) => {
                    const noShow = entry.student_number ? noShowByStudent[entry.student_number] : undefined;
                    const name = noShow?.student_name || (entry.student_number ? personInfo[entry.student_number]?.student_name : null);
                    return (
                      <tr key={entry.id} style={{ opacity: entry.active ? 1 : 0.55 }}>
                        <td data-label="状態">
                          <strong>{entry.active ? 'イエローリスト（手動登録）' : '解除済み'}</strong>
                          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>登録 {formatDateTime(entry.created_at)}</span>
                          {!entry.active && entry.removed_at && (
                            <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>解除 {formatDateTime(entry.removed_at)}</span>
                          )}
                        </td>
                        <td data-label="氏名">{name || '-'}</td>
                        <td data-label="学籍番号">
                          {entry.student_number || '-'}
                          {entry.university_email && <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{entry.university_email}</span>}
                        </td>
                        <td data-label="来なかった回数">{noShow ? `${noShow.noshow_count}回` : '-'}</td>
                        <td data-label="最後に来なかった日時">{formatDateTime(noShow?.last_noshow_at ?? null)}</td>
                        <td data-label="理由" style={{ whiteSpace: 'pre-wrap', minWidth: 220 }}>{entry.reason}</td>
                        <td data-label="解除予定">{entry.expires_at ? formatDateTime(entry.expires_at) : '期限なし'}</td>
                        <td className="admin-table-stack-actions">
                          {entry.active ? (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleYellowDeactivate(entry)}>
                              解除
                            </button>
                          ) : (
                            <button className="btn btn-secondary btn-sm" type="button" onClick={() => handleYellowReactivate(entry)}>
                              再登録
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {autoYellowUsers.map((row) => (
                    <tr key={`auto-${row.student_number}`}>
                      <td data-label="状態"><strong>イエローリスト（自動）</strong></td>
                      <td data-label="氏名">{row.student_name || '-'}</td>
                      <td data-label="学籍番号">{row.student_number}</td>
                      <td data-label="来なかった回数">{row.noshow_count}回</td>
                      <td data-label="最後に来なかった日時">{formatDateTime(row.last_noshow_at)}</td>
                      <td data-label="理由">支払いに{row.noshow_count}回来なかったため</td>
                      <td data-label="解除予定">-</td>
                      <td className="admin-table-stack-actions" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleYellowEntries.length === 0 && autoYellowUsers.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: 16 }}>該当する人はいません。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
