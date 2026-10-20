'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save, Search, TicketPlus, UserRoundCog, X } from 'lucide-react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { adminSupabase as supabase } from '@/lib/supabase';
import { type PaymentVisitSlot, VISIT_SLOT_COLUMNS, formatVisitSlot, jstDateKey } from '@/lib/paymentVisit';

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

type SortKey = 'number' | 'newest' | 'name' | 'active';
type ListFilter = 'all' | 'today' | 'with_active' | 'without_active';

type EventOption = { id: string; title: string; payment_required: boolean | null };
type SlotOption = {
  id: string;
  label: string;
  is_enabled: boolean;
  reservation_capacity: number;
  reserved_count: number;
  remaining_reservation_slots: number;
};

/** 検索用に揃える（大文字小文字・空白・学籍番号先頭の s を無視） */
function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}

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
  const [sortKey, setSortKey] = useState<SortKey>('number');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [notice, setNotice] = useState<string | null>(null);

  // 予約を追加
  const [adding, setAdding] = useState<UserProfileRow | null>(null);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [addEventId, setAddEventId] = useState('');
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [addSlotId, setAddSlotId] = useState('');
  const [paidNow, setPaidNow] = useState(true);
  const [visitSlots, setVisitSlots] = useState<PaymentVisitSlot[]>([]);
  const [visitSlotId, setVisitSlotId] = useState('');
  const [allowOver, setAllowOver] = useState(false);
  const [addNote, setAddNote] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // 一覧は全員を取得して、検索・絞り込み・並べ替えは画面側で行う（打ちながら絞り込める）
  const loadProfiles = async () => {
    setLoading(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_list_user_profiles', {
      p_search: null,
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
    if (!authLoading && user) void loadProfiles();
  }, [authLoading, user]);

  const todayKey = jstDateKey(new Date());
  const filterCounts = useMemo(() => ({
    all: profiles.length,
    today: profiles.filter((p) => jstDateKey(p.created_at) === todayKey).length,
    with_active: profiles.filter((p) => p.active_reservation_count > 0).length,
    without_active: profiles.filter((p) => p.active_reservation_count === 0).length,
  }), [profiles, todayKey]);

  const visibleProfiles = useMemo(() => {
    const q = normalizeSearch(search).replace(/^s(?=\d)/, '');
    const rows = profiles.filter((p) => {
      if (listFilter === 'today' && jstDateKey(p.created_at) !== todayKey) return false;
      if (listFilter === 'with_active' && p.active_reservation_count === 0) return false;
      if (listFilter === 'without_active' && p.active_reservation_count > 0) return false;
      if (!q) return true;
      return [p.student_name, p.student_number, p.university_email].some((v) => normalizeSearch(v || '').includes(q));
    });
    return [...rows].sort((a, b) => {
      if (sortKey === 'newest') return b.created_at.localeCompare(a.created_at);
      if (sortKey === 'name') return a.student_name.localeCompare(b.student_name, 'ja');
      if (sortKey === 'active') return b.active_reservation_count - a.active_reservation_count || a.student_number.localeCompare(b.student_number);
      return a.student_number.localeCompare(b.student_number);
    });
  }, [profiles, search, listFilter, sortKey, todayKey]);

  const selectedEvent = events.find((e) => e.id === addEventId) || null;
  const selectedSlot = slots.find((s) => s.id === addSlotId) || null;
  const slotIsFull = Boolean(selectedSlot && selectedSlot.remaining_reservation_slots <= 0);
  const needsPayment = Boolean(selectedEvent?.payment_required);

  const loadSlots = async (eventId: string) => {
    setSlots([]);
    setAddSlotId('');
    setAllowOver(false);
    if (!eventId) return;
    const { data, error: rpcError } = await supabase.rpc('admin_get_event_slots', { p_event_id: eventId });
    if (rpcError) {
      setAddError(rpcError.message);
      return;
    }
    setSlots(((data as SlotOption[] | null) || []).filter((slot) => slot.is_enabled));
  };

  const startAdd = async (profile: UserProfileRow) => {
    setAdding(profile);
    setAddError(null);
    setNotice(null);
    setPaidNow(true);
    setVisitSlotId('');
    setAllowOver(false);
    setAddNote('');
    const [{ data: eventData, error: eventError }, { data: visitData }] = await Promise.all([
      supabase.from('events').select('id,title,payment_required').order('created_at', { ascending: false }),
      supabase.from('payment_visit_slots').select(VISIT_SLOT_COLUMNS).eq('is_active', true).gt('ends_at', new Date().toISOString()).order('starts_at', { ascending: true }),
    ]);
    if (eventError) {
      setAddError(eventError.message);
      return;
    }
    const list = (eventData as EventOption[] | null) || [];
    setEvents(list);
    setVisitSlots((visitData as PaymentVisitSlot[] | null) || []);
    const firstId = list[0]?.id || '';
    setAddEventId(firstId);
    await loadSlots(firstId);
  };

  const submitAdd = async () => {
    if (!adding || !addEventId || !addSlotId) {
      setAddError('企画と受け取り枠を選んでください。');
      return;
    }
    if (needsPayment && !paidNow && !visitSlotId) {
      setAddError('支払い日時を選んでください。');
      return;
    }
    if (slotIsFull && !allowOver) {
      setAddError('この枠は満席です。追加する場合は「満席でも定員を1人分増やして追加する」にチェックを入れてください。');
      return;
    }
    setSaving(true);
    setAddError(null);
    const { data, error: rpcError } = await supabase.rpc('admin_create_reservation_for_user', {
      p_user_id: adding.user_id,
      p_event_id: addEventId,
      p_event_slot_id: addSlotId,
      p_paid: needsPayment ? paidNow : false,
      p_payment_visit_slot_id: needsPayment && !paidNow ? visitSlotId : null,
      p_allow_over_capacity: allowOver,
      p_note: addNote.trim() || null,
    });
    setSaving(false);
    if (rpcError) {
      setAddError(rpcError.message || '予約を追加できませんでした。');
      return;
    }
    const result = data as { slot_label?: string; payment_status?: string; capacity_raised?: boolean } | null;
    const payText = result?.payment_status === 'paid' ? '支払い済み' : result?.payment_status === 'pending' ? '支払い待ち' : '';
    setNotice(`${adding.student_name}（${adding.student_number}）の予約を追加しました：${result?.slot_label || ''}${payText ? `・${payText}` : ''}${result?.capacity_raised ? '（定員を1人分増やしました）' : ''}`);
    setAdding(null);
    await loadProfiles();
  };

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
                <p style={{ color: 'var(--text-secondary)', marginTop: 6 }}>予約サイトにログインしたことがある学生の一覧です。氏名の修正や、運営による予約の追加ができます。予約を追加したい人が一覧にいない場合は、先に本人に一度予約サイトへログインしてもらってください。</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadProfiles()} disabled={loading}>最新にする</button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 0 }}>
                <Search size={17} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input className="form-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="氏名・学籍番号・メールで検索" style={{ paddingLeft: 38, width: '100%' }} aria-label="利用者を検索" />
              </div>
              <select className="form-input" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)} style={{ width: 'auto' }} aria-label="並べ替え">
                <option value="number">学籍番号順</option>
                <option value="newest">登録が新しい順</option>
                <option value="name">氏名順</option>
                <option value="active">有効予約が多い順</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {([
                ['all', '全員'],
                ['today', '今日登録'],
                ['with_active', '有効予約あり'],
                ['without_active', '有効予約なし'],
              ] as const).map(([key, label]) => (
                <button key={key} type="button" className={`btn ${listFilter === key ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setListFilter(key)}>
                  {label}（{filterCounts[key]}）
                </button>
              ))}
            </div>
          </div>

          {notice && <div className="success-banner" style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: '1px solid var(--color-success-border)', background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>{notice}</div>}

          {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

          <div className="glass-card">
            <div style={{ marginBottom: 14, color: 'var(--text-secondary)' }}>表示中 {visibleProfiles.length}人 ／ 登録済み {profiles.length}人</div>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 36 }}><div className="loading-spinner" /></div>
            ) : visibleProfiles.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 36, color: 'var(--text-secondary)' }}>該当する利用者はいません。</div>
            ) : (
              <div className="admin-table-container">
                <table className="admin-table admin-table-stack">
                  <thead><tr><th>氏名</th><th>学籍番号</th><th>大学メール</th><th>予約記録</th><th>有効予約</th><th>登録日</th><th>最終氏名変更</th><th>操作</th></tr></thead>
                  <tbody>
                    {visibleProfiles.map((profile) => (
                      <tr key={profile.user_id}>
                        <td className="admin-table-stack-title"><strong>{profile.student_name}</strong></td>
                        <td data-label="学籍番号">{profile.student_number}</td>
                        <td data-label="大学メール">{profile.university_email}</td>
                        <td data-label="予約記録">{profile.reservation_count}</td>
                        <td data-label="有効予約">{profile.active_reservation_count}</td>
                        <td data-label="登録日">{formatDate(profile.created_at)}</td>
                        <td data-label="最終氏名変更">{formatDate(profile.name_updated_at)}</td>
                        <td className="admin-table-stack-actions">
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => void startAdd(profile)}><TicketPlus size={15} aria-hidden="true" />予約を追加</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => startEdit(profile)}>氏名を修正</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {adding && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 560, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <h2>予約を追加</h2>
              <button type="button" onClick={() => setAdding(null)} aria-label="閉じる" style={{ border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}><X size={22} /></button>
            </div>
            <div className="glass-card" style={{ margin: '12px 0' }}>
              <strong>{adding.student_name}</strong>（{adding.student_number}）
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginTop: 4 }}>本人のアカウントにつなぐので、本人のマイチケットにそのまま表示されます。受付期間外でも追加できます。</div>
            </div>

            {addError && <div className="error-banner" style={{ marginBottom: 12 }}>{addError}</div>}

            <div className="form-group">
              <label className="form-label" htmlFor="addEvent">企画</label>
              <select id="addEvent" className="form-input" value={addEventId} onChange={(event) => { setAddEventId(event.target.value); void loadSlots(event.target.value); }} disabled={saving}>
                {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
              </select>
            </div>

            <div className="form-group">
              <div className="form-label">受け取り枠</div>
              {slots.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)', margin: 0 }}>読み込み中、または枠がありません。</p>
              ) : (
                <div style={{ display: 'grid', gap: 6 }}>
                  {slots.map((slot) => {
                    const full = slot.remaining_reservation_slots <= 0;
                    return (
                      <label key={slot.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, border: `1px solid ${addSlotId === slot.id ? 'var(--color-primary)' : 'var(--card-border)'}`, cursor: 'pointer' }}>
                        <input type="radio" name="addSlot" checked={addSlotId === slot.id} onChange={() => { setAddSlotId(slot.id); setAllowOver(false); }} disabled={saving} />
                        <span style={{ flex: 1 }}>{slot.label}</span>
                        <span style={{ fontSize: '0.8rem', color: full ? 'var(--color-danger)' : 'var(--text-secondary)' }}>{slot.reserved_count}/{slot.reservation_capacity}{full ? '・満席' : ''}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {slotIsFull && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontWeight: 600 }}>
                  <input type="checkbox" checked={allowOver} onChange={(event) => { setAllowOver(event.target.checked); setAddError(null); }} disabled={saving} />
                  満席でも定員を1人分増やして追加する
                </label>
              )}
            </div>

            {needsPayment && (
              <div className="form-group">
                <div className="form-label">支払い</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <input type="radio" name="addPay" checked={paidNow} onChange={() => setPaidNow(true)} disabled={saving} />
                  支払い済みにする（お金を受け取った）
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="radio" name="addPay" checked={!paidNow} onChange={() => setPaidNow(false)} disabled={saving} />
                  支払い日時を選ぶ（来なければ自動キャンセル）
                </label>
                {!paidNow && (
                  <select className="form-input" value={visitSlotId} onChange={(event) => setVisitSlotId(event.target.value)} disabled={saving} style={{ marginTop: 8 }}>
                    <option value="">支払い日時を選択</option>
                    {visitSlots.map((visit) => <option key={visit.id} value={visit.id}>{formatVisitSlot(visit)}{visit.note ? `（${visit.note}）` : ''}</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="addNote">メモ（任意・管理記録に残ります）</label>
              <input id="addNote" className="form-input" value={addNote} onChange={(event) => setAddNote(event.target.value)} maxLength={200} disabled={saving} placeholder="例：受付終了後に企画長の判断で追加" />
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setAdding(null)} disabled={saving}>キャンセル</button>
              <button type="button" className="btn btn-primary" onClick={() => void submitAdd()} disabled={saving || !addSlotId}><TicketPlus size={17} aria-hidden="true" />{saving ? '追加中...' : '予約を追加'}</button>
            </div>
          </div>
        </div>
      )}

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
