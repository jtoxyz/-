'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { adminSupabase as supabase } from '@/lib/supabase';
import { type PaymentVisitSlot, VISIT_SLOT_COLUMNS, formatVisitSlot, jstDateKey, visitSlotPlace } from '@/lib/paymentVisit';

type PaymentStatus = 'not_required' | 'pending' | 'paid' | 'expired';
type EventItem = { id: string; title: string };
type ReservationRow = {
  id: string;
  student_name: string;
  student_number: string;
  university_email: string;
  status: string;
  payment_status: PaymentStatus;
  payment_due_at: string | null;
  paid_at: string | null;
  created_at: string;
  event_id: string;
  event_slots?: { label: string | null } | null;
  payment_visit_slot_id: string | null;
  payment_visit_slots?: PaymentVisitSlot | null;
};

type SortKey = 'visit' | 'number' | 'created';

type SlotSummary = { slot: PaymentVisitSlot; total: number; pending: number; paid: number };

const labels: Record<PaymentStatus, string> = {
  not_required: '支払い不要',
  pending: '未払い',
  paid: '支払い済み',
  expired: '期限切れ',
};

function formatDate(value: string | null) {
  if (!value) return '―';
  return new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

/** 例: 10/14(水) */
function formatDayKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+09:00`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
}

function visitDayKey(row: ReservationRow): string | null {
  return row.payment_visit_slots ? jstDateKey(row.payment_visit_slots.starts_at) : null;
}

/** 支払いに来る予定の人（キャンセル・期限切れを除く） */
function isComing(row: ReservationRow) {
  return row.status !== 'cancelled' && (row.payment_status === 'pending' || row.payment_status === 'paid');
}

function compareRows(sortKey: SortKey) {
  return (a: ReservationRow, b: ReservationRow) => {
    if (sortKey === 'created') return b.created_at.localeCompare(a.created_at);
    if (sortKey === 'visit') {
      const av = a.payment_visit_slots?.starts_at;
      const bv = b.payment_visit_slots?.starts_at;
      if (av !== bv) {
        if (!av) return 1;
        if (!bv) return -1;
        return av.localeCompare(bv);
      }
    }
    return a.student_number.localeCompare(b.student_number);
  };
}

export default function PaymentManagementPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [filter, setFilter] = useState<'all' | PaymentStatus>('all');
  const [dayFilter, setDayFilter] = useState<string>('all');
  const [slotFilter, setSlotFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('visit');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = async () => {
    const { data, error: fetchError } = await supabase
      .from('events')
      .select('id,title')
      .eq('payment_required', true)
      .order('created_at', { ascending: false });
    if (fetchError) throw fetchError;
    const items = (data as EventItem[]) || [];
    setEvents(items);
    setEventId((current) => current || items[0]?.id || '');
  };

  const loadRows = async (targetEventId: string) => {
    if (!targetEventId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('reservations')
      .select(`id,student_name,student_number,university_email,status,payment_status,payment_due_at,paid_at,created_at,event_id,event_slots(label),payment_visit_slot_id,payment_visit_slots(${VISIT_SLOT_COLUMNS})`)
      .eq('event_id', targetEventId)
      .order('created_at', { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
    } else {
      setRows((data as unknown as ReservationRow[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authLoading || !user) return;
    loadEvents().catch((err) => {
      setError(err.message || '企画一覧の取得に失敗しました。');
      setLoading(false);
    });
  }, [authLoading, user]);

  useEffect(() => {
    if (eventId) void loadRows(eventId);
  }, [eventId]);

  const changeEvent = (nextEventId: string) => {
    setEventId(nextEventId);
    setDayFilter('all');
    setSlotFilter('all');
  };

  const todayKey = jstDateKey(new Date());

  // 支払いに来る日ごとの人数（今日は常に先頭に出す）
  const visitDays = useMemo(() => {
    const perDay: Record<string, number> = { [todayKey]: 0 };
    for (const row of rows) {
      const key = visitDayKey(row);
      if (!key) continue;
      perDay[key] = (perDay[key] || 0) + (isComing(row) ? 1 : 0);
    }
    const others = Object.keys(perDay).filter((key) => key !== todayKey).sort();
    return [todayKey, ...others].map((key) => ({ key, count: perDay[key] }));
  }, [rows, todayKey]);

  const dayRows = useMemo(
    () => (dayFilter === 'all' ? rows : rows.filter((row) => visitDayKey(row) === dayFilter)),
    [rows, dayFilter]
  );

  // 選んだ日の時間枠ごとの人数
  const slotSummaries = useMemo(() => {
    const map = new Map<string, SlotSummary>();
    for (const row of dayRows) {
      const slot = row.payment_visit_slots;
      if (!slot) continue;
      const entry = map.get(slot.id) || { slot, total: 0, pending: 0, paid: 0 };
      if (isComing(row)) {
        entry.total += 1;
        if (row.payment_status === 'paid') entry.paid += 1;
        else entry.pending += 1;
      }
      map.set(slot.id, entry);
    }
    return [...map.values()].sort((a, b) => a.slot.starts_at.localeCompare(b.slot.starts_at));
  }, [dayRows]);

  const scopedRows = useMemo(
    () => (slotFilter === 'all' ? dayRows : dayRows.filter((row) => row.payment_visit_slot_id === slotFilter)),
    [dayRows, slotFilter]
  );

  const counts = useMemo(() => ({
    all: scopedRows.length,
    pending: scopedRows.filter((r) => r.payment_status === 'pending').length,
    paid: scopedRows.filter((r) => r.payment_status === 'paid').length,
    expired: scopedRows.filter((r) => r.payment_status === 'expired').length,
    not_required: scopedRows.filter((r) => r.payment_status === 'not_required').length,
  }), [scopedRows]);

  const visibleRows = useMemo(
    () => scopedRows.filter((row) => filter === 'all' || row.payment_status === filter).sort(compareRows(sortKey)),
    [scopedRows, filter, sortKey]
  );

  const dayTotal = slotSummaries.reduce(
    (sum, item) => ({ total: sum.total + item.total, pending: sum.pending + item.pending, paid: sum.paid + item.paid }),
    { total: 0, pending: 0, paid: 0 }
  );

  const setPaid = async (reservationId: string, paid: boolean) => {
    setUpdatingId(reservationId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_reservation_payment_status', {
      p_reservation_id: reservationId,
      p_paid: paid,
    });
    if (rpcError) {
      setError(rpcError.message);
    } else {
      await loadRows(eventId);
    }
    setUpdatingId(null);
  };

  const expireNow = async () => {
    const { data, error: rpcError } = await supabase.rpc('admin_expire_unpaid_reservations');
    if (rpcError) setError(rpcError.message);
    else {
      alert(`${Number(data || 0)}件の期限切れ未払い予約をキャンセルしました。`);
      await loadRows(eventId);
    }
  };

  if (authLoading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" /></div>;

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <main>
          <div className="glass-card">
            <h1 style={{ marginTop: 0 }}>支払い管理</h1>
            <p style={{ color: 'var(--text-secondary)' }}>予約者の支払い状態を確認し、手動で支払い済み・未払いへ変更できます。</p>
            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 18 }}>
              <div className="form-group" style={{ flex: '1 1 280px', maxWidth: 520, minWidth: 0, margin: 0 }}>
                <label className="form-label">企画</label>
                <select className="form-input" value={eventId} onChange={(e) => changeEvent(e.target.value)}>
                  {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                </select>
              </div>
              <button className="btn btn-secondary" onClick={expireNow}>期限切れを今すぐ反映</button>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div className="form-label">支払いに来る日</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className={`btn ${dayFilter === 'all' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => { setDayFilter('all'); setSlotFilter('all'); }}>全日程</button>
                {visitDays.map(({ key, count }) => (
                  <button key={key} className={`btn ${dayFilter === key ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => { setDayFilter(key); setSlotFilter('all'); }}>
                    {key === todayKey ? `今日 ${formatDayKey(key)}` : formatDayKey(key)}（{count}人）
                  </button>
                ))}
              </div>
            </div>

            {dayFilter !== 'all' && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                  {formatDayKey(dayFilter)} に支払いに来る予定：{dayTotal.total}人（未払い {dayTotal.pending}人・支払い済み {dayTotal.paid}人）
                </div>
                {slotSummaries.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', margin: 0 }}>この日に支払いに来る予定の人はいません。</p>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                    {slotSummaries.map(({ slot, total, pending, paid }) => {
                      const active = slotFilter === slot.id;
                      return (
                        <button key={slot.id} type="button" className="glass-card interactive" onClick={() => setSlotFilter(active ? 'all' : slot.id)} style={{ textAlign: 'left', padding: 14, margin: 0, borderColor: active ? 'var(--color-primary)' : 'var(--card-border)', background: active ? 'var(--color-primary-glow)' : 'var(--card-bg)' }}>
                          <strong>{formatVisitSlot(slot)}</strong>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>{[slot.note, visitSlotPlace(slot)].filter(Boolean).join('・')}</div>
                          <div style={{ fontSize: '1.4rem', fontWeight: 800, marginTop: 6 }}>{total}人</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>未払い {pending}人・支払い済み {paid}人</div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {slotFilter !== 'all' && <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '8px 0 0' }}>選んだ時間枠の人だけを表示中です。もう一度押すと解除します。</p>}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 18 }}>
              {(['all','pending','paid','expired','not_required'] as const).map((key) => (
                <button key={key} className={`btn ${filter === key ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setFilter(key)}>
                  {key === 'all' ? '全件' : labels[key]} ({counts[key]})
                </button>
              ))}
              <select className="form-input" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ width: 'auto', marginLeft: 'auto' }} aria-label="並べ替え">
                <option value="visit">支払いに来る日時順</option>
                <option value="number">学籍番号順</option>
                <option value="created">予約が新しい順</option>
              </select>
            </div>

            {loading ? <div className="loading-spinner" /> : (
              <div className="admin-table-container reservations-table-desktop">
                <table className="admin-table admin-table-stack">
                  <thead><tr><th>氏名</th><th>学籍番号</th><th>枠</th><th>支払いに来る日時</th><th>支払い状態</th><th>期限</th><th>支払日時</th><th>操作</th></tr></thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.id} style={{ opacity: row.status === 'cancelled' ? 0.5 : 1 }}>
                        <td data-label="氏名">{row.student_name}</td>
                        <td data-label="学籍番号">{row.student_number}</td>
                        <td data-label="枠">{row.event_slots?.label || '―'}</td>
                        <td data-label="支払いに来る日時">
                          {row.payment_visit_slots ? (
                            <span>{formatVisitSlot(row.payment_visit_slots)}{row.payment_visit_slots.note ? `（${row.payment_visit_slots.note}）` : ''}</span>
                          ) : '―'}
                        </td>
                        <td data-label="支払い状態"><span><strong>{labels[row.payment_status]}</strong>{row.status === 'cancelled' ? '（キャンセル済み）' : ''}</span></td>
                        <td data-label="期限">{formatDate(row.payment_due_at)}</td>
                        <td data-label="支払日時">{formatDate(row.paid_at)}</td>
                        <td className="admin-table-stack-actions">
                          {row.payment_status !== 'not_required' && row.status !== 'cancelled' && (
                            row.payment_status === 'paid' ?
                              <button className="btn btn-secondary btn-sm" disabled={updatingId === row.id} onClick={() => setPaid(row.id, false)}>未払いに戻す</button> :
                              <button className="btn btn-primary btn-sm" disabled={updatingId === row.id} onClick={() => setPaid(row.id, true)}>支払い済みにする</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleRows.length === 0 && <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>該当する予約はありません。</p>}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
