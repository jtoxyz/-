'use client';

import { useEffect, useState } from 'react';
import { Save, Search, UserRoundCog, X } from 'lucide-react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';

type UserProfileRow = {
  user_id: string;
  university_email: string;
  student_number: string;
  student_name: string;
  created_at: string;
  updated_at: string;
  name_updated_at: string | null;
  reservation_count: number;
  active_reservation_count: number;
};

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  });
}

export default function AdminUsersPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [profiles, setProfiles] = useState<UserProfileRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserProfileRow | null>(null);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadProfiles = async (query = search) => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_list_user_profiles', {
      p_search: query.trim() || null,
    });
    if (rpcError) {
      setError(rpcError.message || '利用者一覧を取得できませんでした。');
      setProfiles([]);
    } else {
      setProfiles((data as UserProfileRow[] | null) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user) void loadProfiles('');
  }, [authLoading, user]);

  const startEdit = (profile: UserProfileRow) => {
    setEditing(profile);
    setNewName(profile.student_name);
    setError(null);
  };

  const saveName = async () => {
    if (!editing) return;
    const cleanName = newName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setError('氏名を入力してください。');
      return;
    }
    if (!confirm(`${editing.student_number} の氏名を「${cleanName}」へ変更しますか？\n関連する予約・事前登録の氏名も更新されます。`)) return;

    setSaving(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_update_profile_name', {
      p_user_id: editing.user_id,
      p_student_name: cleanName,
    });
    if (rpcError) {
      setError(rpcError.message || '氏名を変更できませんでした。');
    } else {
      setEditing(null);
      await loadProfiles();
    }
    setSaving(false);
  };

  if (authLoading) return <div style={{ textAlign: 'center', padding: 60 }}><div className="loading-spinner" /></div>;

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div>
          <div className="glass-card" style={{ borderLeft: '4px solid var(--color-primary)', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div>
                <h1 style={{ display: 'flex', alignItems: 'center', gap: 9 }}><UserRoundCog size={27} aria-hidden="true" />利用者管理</h1>
                <p style={{ color: 'var(--text-secondary)', marginTop: 6 }}>初回登録された固定氏名を管理者だけが修正できます。</p>
              </div>
              <form onSubmit={(event) => { event.preventDefault(); void loadProfiles(); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="氏名・学籍番号・メールで検索" style={{ minWidth: 260 }} />
                <button className="btn btn-secondary" type="submit" disabled={loading}><Search size={17} aria-hidden="true" />検索</button>
              </form>
            </div>
          </div>

          {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

          <div className="glass-card">
            <div style={{ marginBottom: 14, color: 'var(--text-secondary)' }}>登録済み利用者：{profiles.length}人</div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 36 }}><div className="loading-spinner" /></div>
            ) : profiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-secondary)' }}>該当する利用者はいません。</div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table">
                  <thead><tr><th>氏名</th><th>学籍番号</th><th>大学メール</th><th>予約記録</th><th>有効予約</th><th>登録日</th><th>最終氏名変更</th><th>操作</th></tr></thead>
                  <tbody>
                    {profiles.map((profile) => (
                      <tr key={profile.user_id}>
                        <td><strong>{profile.student_name}</strong></td>
                        <td>{profile.student_number}</td>
                        <td>{profile.university_email}</td>
                        <td>{profile.reservation_count}</td>
                        <td>{profile.active_reservation_count}</td>
                        <td>{formatDate(profile.created_at)}</td>
                        <td>{formatDate(profile.name_updated_at)}</td>
                        <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(profile)}>氏名を修正</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {editing && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <h2>利用者氏名の修正</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="閉じる" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={22} /></button>
            </div>
            <div className="glass-card" style={{ margin: '16px 0' }}>
              <div>{editing.student_number}</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: 4 }}>{editing.university_email}</div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="newProfileName">新しい正式氏名</label>
              <input id="newProfileName" className="form-input" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={100} disabled={saving} />
              <span className="form-hint">この利用者に紐づく既存予約と事前登録の氏名も同時に更新され、管理者操作履歴へ記録されます。</span>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={saving}>キャンセル</button>
              <button type="button" className="btn btn-primary" onClick={saveName} disabled={saving}><Save size={17} aria-hidden="true" />{saving ? '変更中...' : '氏名を変更'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
