'use client';

import { useState } from 'react';
import { IdCard, Plus, Save, Trash2, TriangleAlert } from 'lucide-react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { STUDENT_EMAIL_DOMAIN } from '@/lib/config';
import { formatJstDateTime } from '@/lib/jst';
import { adminSupabase as supabase } from '@/lib/supabase';

type EventItem = { id: string; title: string; is_public: boolean; starts_at: string | null };
type StaffRow = {
  id: string;
  email: string;
  display_name: string | null;
  note: string | null;
  is_active: boolean;
  created_at: string;
  staff_event_access: { event_id: string }[];
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;

/** 担当企画のチェックボックス */
function EventPicker({ events, selected, onChange, idPrefix }: {
  events: EventItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
  idPrefix: string;
}) {
  if (events.length === 0) return <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>企画がありません。</p>;
  return (
    <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto', padding: 10, border: '1px solid var(--card-border)', borderRadius: 'var(--radius-sm)' }}>
      {events.map((event) => {
        const id = `${idPrefix}-${event.id}`;
        const checked = selected.includes(event.id);
        return (
          <label key={event.id} htmlFor={id} className="form-checkbox-label" style={{ fontSize: '0.9rem' }}>
            <input
              id={id}
              type="checkbox"
              className="form-checkbox"
              checked={checked}
              onChange={() => onChange(checked ? selected.filter((v) => v !== event.id) : [...selected, event.id])}
            />
            <span>
              {event.title}
              {!event.is_public && <span style={{ color: 'var(--text-secondary)' }}>（非公開）</span>}
              {event.starts_at && <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>　{formatJstDateTime(event.starts_at)}〜</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export default function AdminStaffPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // 追加フォーム
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [newEvents, setNewEvents] = useState<string[]>([]);

  // 編集中の担当企画（スタッフごと）
  const [editEvents, setEditEvents] = useState<Record<string, string[]>>({});

  const load = async () => {
    const [eventResult, staffResult] = await Promise.all([
      supabase.from('events').select('id,title,is_public,starts_at').order('created_at', { ascending: false }),
      supabase.from('staff_members').select('id,email,display_name,note,is_active,created_at,staff_event_access(event_id)').order('created_at', { ascending: true }),
    ]);
    if (eventResult.error) setError(eventResult.error.message);
    else setEvents((eventResult.data as EventItem[]) || []);
    if (staffResult.error) {
      setError(
        staffResult.error.code === '42P01' || /staff_members/.test(staffResult.error.message)
          ? 'スタッフ機能のデータベース設定がまだ適用されていません（staff_members_and_staff_rpcs のマイグレーション）。'
          : staffResult.error.message,
      );
    } else {
      const rows = (staffResult.data as StaffRow[]) || [];
      setStaff(rows);
      setEditEvents(Object.fromEntries(rows.map((row) => [row.id, row.staff_event_access.map((a) => a.event_id)])));
    }
    setLoading(false);
  };

  useLoadEffect(() => {
    if (!authLoading && user) return load();
  }, [authLoading, user]);

  const addStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(cleanEmail)) {
      setError('メールアドレスの形が正しくありません。');
      return;
    }
    if (staff.some((row) => row.email === cleanEmail)) {
      setError('このメールアドレスはすでに登録されています。');
      return;
    }
    setSaving('new');
    const { data, error: insertError } = await supabase
      .from('staff_members')
      .insert({ email: cleanEmail, display_name: displayName.trim() || null, note: note.trim() || null, created_by: user?.id ?? null })
      .select('id')
      .single();
    if (insertError || !data) {
      setError(insertError?.message || 'スタッフを追加できませんでした。');
      setSaving(null);
      return;
    }
    if (newEvents.length > 0) {
      const { error: accessError } = await supabase
        .from('staff_event_access')
        .insert(newEvents.map((eventId) => ({ staff_id: data.id, event_id: eventId })));
      if (accessError) setError(`スタッフは追加しましたが、担当企画を保存できませんでした：${accessError.message}`);
    }
    setEmail('');
    setDisplayName('');
    setNote('');
    setNewEvents([]);
    setNotice(`${cleanEmail} をスタッフに追加しました。`);
    setSaving(null);
    await load();
  };

  const saveEvents = async (row: StaffRow) => {
    setError(null);
    setNotice(null);
    setSaving(row.id);
    const before = row.staff_event_access.map((a) => a.event_id);
    const after = editEvents[row.id] ?? [];
    const added = after.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !after.includes(id));
    if (removed.length > 0) {
      const { error: deleteError } = await supabase.from('staff_event_access').delete().eq('staff_id', row.id).in('event_id', removed);
      if (deleteError) {
        setError(deleteError.message);
        setSaving(null);
        return;
      }
    }
    if (added.length > 0) {
      const { error: insertError } = await supabase.from('staff_event_access').insert(added.map((eventId) => ({ staff_id: row.id, event_id: eventId })));
      if (insertError) {
        setError(insertError.message);
        setSaving(null);
        return;
      }
    }
    setNotice(`${row.display_name || row.email} の担当企画を保存しました。`);
    setSaving(null);
    await load();
  };

  const toggleActive = async (row: StaffRow) => {
    setSaving(row.id);
    const { error: updateError } = await supabase.from('staff_members').update({ is_active: !row.is_active }).eq('id', row.id);
    if (updateError) setError(updateError.message);
    setSaving(null);
    await load();
  };

  const removeStaff = async (row: StaffRow) => {
    if (!confirm(`${row.display_name || row.email} をスタッフから外しますか？担当企画の割り当ても消えます。`)) return;
    setSaving(row.id);
    const { error: deleteError } = await supabase.from('staff_members').delete().eq('id', row.id);
    if (deleteError) setError(deleteError.message);
    else setNotice(`${row.display_name || row.email} をスタッフから外しました。`);
    setSaving(null);
    await load();
  };

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: 60 }}><div className="loading-spinner" /></div>;
  }

  const eventTitle = (id: string) => events.find((e) => e.id === id)?.title ?? '（削除された企画）';

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div>
          <div className="glass-card">
            <h1 style={{ fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: 8 }}><IdCard size={26} aria-hidden="true" />スタッフ（自治会など）</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: 6 }}>
              登録したスタッフは、管理画面には入れません。<strong>スタッフ用画面（/staff）</strong>から、担当に割り当てた企画についてだけ、
              動的支払いQR・1日支払いQR・受付状況（予約数・受付数・支払い数などの人数）を使えます。企画の編集や予約者の氏名などの個人情報は見られません。
            </p>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '0.88rem' }}>
              スタッフは大学Googleアカウント（@{STUDENT_EMAIL_DOMAIN}）でログインします。そのメールアドレスを登録してください。
            </p>
          </div>

          {error && <div className="error-banner" role="alert"><TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} /><span>{error}</span></div>}
          {notice && <div className="glass-card" role="status" style={{ borderColor: 'var(--color-success-border)', background: 'var(--color-success-bg)', padding: 14 }}>{notice}</div>}

          <form className="glass-card" onSubmit={addStaff}>
            <h2 style={{ fontSize: '1.15rem', marginBottom: 14 }}>スタッフを追加</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
              <div className="form-group">
                <label className="form-label" htmlFor="staff-email">大学Googleアカウントのメールアドレス</label>
                <input id="staff-email" className="form-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={`s24b123@${STUDENT_EMAIL_DOMAIN}`} autoComplete="off" />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="staff-name">表示名（任意）</label>
                <input id="staff-name" className="form-input" value={displayName} maxLength={100} onChange={(e) => setDisplayName(e.target.value)} placeholder="例：自治会 山田" />
              </div>
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="staff-note">メモ（任意）</label>
              <input id="staff-note" className="form-input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="例：11月の合同企画の支払い受付" />
            </div>
            <div className="form-group">
              <span className="form-label">担当する企画</span>
              <EventPicker events={events} selected={newEvents} onChange={setNewEvents} idPrefix="new" />
            </div>
            <button type="submit" className="btn btn-primary" disabled={saving === 'new'}>
              <Plus size={17} aria-hidden="true" />{saving === 'new' ? '追加しています…' : 'スタッフを追加'}
            </button>
          </form>

          <div className="glass-card">
            <h2 style={{ fontSize: '1.15rem', marginBottom: 14 }}>登録済みのスタッフ（{staff.length}人）</h2>
            {staff.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>まだ登録されていません。</p>}
            <div style={{ display: 'grid', gap: 14 }}>
              {staff.map((row) => {
                const selected = editEvents[row.id] ?? [];
                const before = row.staff_event_access.map((a) => a.event_id);
                const changed = selected.length !== before.length || selected.some((id) => !before.includes(id));
                return (
                  <section key={row.id} className="glass-card" style={{ margin: 0, padding: 16, opacity: row.is_active ? 1 : 0.65 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <strong>{row.display_name || row.email}</strong>
                        {!row.is_active && <span className="badge badge-secondary" style={{ marginLeft: 8 }}>停止中</span>}
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{row.email}</div>
                        {row.note && <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>{row.note}</div>}
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                          担当：{before.length > 0 ? before.map(eventTitle).join('、') : 'なし'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void toggleActive(row)} disabled={saving === row.id}>
                          {row.is_active ? '一時停止' : '再開'}
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => void removeStaff(row)} disabled={saving === row.id}>
                          <Trash2 size={14} aria-hidden="true" />外す
                        </button>
                      </div>
                    </div>
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: 'pointer', fontSize: '0.88rem' }}>担当企画を変更</summary>
                      <div style={{ marginTop: 10 }}>
                        <EventPicker events={events} selected={selected} onChange={(ids) => setEditEvents((cur) => ({ ...cur, [row.id]: ids }))} idPrefix={row.id} />
                        <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => void saveEvents(row)} disabled={!changed || saving === row.id}>
                          <Save size={14} aria-hidden="true" />担当企画を保存
                        </button>
                      </div>
                    </details>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
