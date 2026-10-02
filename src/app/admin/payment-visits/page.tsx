'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';
import { type PaymentVisitSlot, formatVisitSlot, jstDateKey } from '@/lib/paymentVisit';

type VisitReservation = {
  id: string;
  student_name: string;
  student_number: string;
  status: string;
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  paid_at: string | null;
  payment_visit_slot_id: string;
  events: { title: string } | null;
};

const paymentLabels: Record<VisitReservation['payment_status'], string> = {
  not_required: '支払い不要',
  pending: '未払い',
  paid: '支払い済み',
  expired: '期限切れ',
};

function shiftDate(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return jstDateKey(date);
}

function jstIso(dateKey: string, time: string): string {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

function isCounted(row: VisitReservation): boolean {
  return row.status !== 'cancelled';
}

export default function PaymentVisitsPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [dateKey, setDateKey] = useState(() => jstDateKey(new Date()));
  const [daySlots, setDaySlots] = useState<PaymentVisitSlot[]>([]);
  const [rows, setRows] = useState<VisitReservation[]>([]);
  const [upcoming, setUpcoming] = useState<PaymentVisitSlot[]>([]);
  const [upcomingCounts, setUpcomingCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [newDate, setNewDate] = useState(() => jstDateKey(new Date()));
  const [newStart, setNewStart] = useState('12:30');
  const [newEnd, setNewEnd] = useState('13:00');
  const [newNote, setNewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const loadDay = useCallback(async (key: string) => {
    const { data: slotData, error: slotError } = await supabase
      .from('payment_visit_slots')
      .select('id,starts_at,ends_at,note,is_active')
      .gte('starts_at', jstIso(key, '00:00'))
      .lt('starts_at', jstIso(shiftDate(key, 1), '00:00'))
      .order('starts_at', { ascending: true });
    if (slotError) throw slotError;
    const slots = (slotData as PaymentVisitSlot[]) || [];
    setDaySlots(slots);

    if (slots.length === 0) {
      setRows([]);
      return;
    }
    const { data: rowData, error: rowError } = await supabase
      .from('reservations')
      .select('id,student_name,student_number,status,payment_status,paid_at,payment_visit_slot_id,events(title)')
      .in('payment_visit_slot_id', slots.map((slot) => slot.id))
      .order('student_number', { ascending: true });
    if (rowError) throw rowError;
    setRows((rowData as unknown as VisitReservation[]) || []);
  }, []);

  const loadUpcoming = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('payment_visit_slots')
      .select('id,starts_at,ends_at,note,is_active')
      .gt('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true });
    if (fetchError) throw fetchError;
    const slots = (data as PaymentVisitSlot[]) || [];
    setUpcoming(slots);

    const counts: Record<string, number> = {};
    if (slots.length > 0) {
      const { data: countData } = await supabase
        .from('reservations')
        .select('payment_visit_slot_id,status')
        .in('payment_visit_slot_id', slots.map((slot) => slot.id))
        .neq('status', 'cancelled');
      for (const row of (countData as { payment_visit_slot_id: string }[]) || []) {
        counts[row.payment_visit_slot_id] = (counts[row.payment_visit_slot_id] || 0) + 1;
      }
    }
    setUpcomingCounts(counts);
  }, []);

  const reload = useCallback(async () => {
    try {
      await Promise.all([loadDay(dateKey), loadUpcoming()]);
      setError(null);
    } catch (err) {
      setError((err as Error).message || 'データの取得に失敗しました。');
    }
    setLoading(false);
  }, [dateKey, loadDay, loadUpcoming]);

  useEffect(() => {
    if (!authLoading && user) void reload();
  }, [authLoading, user, reload]);

  const summary = useMemo(() => {
    const counted = rows.filter(isCounted);
    return {
      total: counted.length,
      paid: counted.filter((row) => row.payment_status === 'paid').length,
      pending: counted.filter((row) => row.payment_status === 'pending').length,
    };
  }, [rows]);

  const setPaid = async (reservationId: string, paid: boolean) => {
    setUpdatingId(reservationId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('admin_set_reservation_payment_status', {
      p_reservation_id: reservationId,
      p_paid: paid,
    });
    if (rpcError) setError(rpcError.message);
    else await loadDay(dateKey);
    setUpdatingId(null);
  };

  const addSlot = async () => {
    if (!newDate || !newStart || !newEnd) return;
    const startsAt = jstIso(newDate, newStart);
    const endsAt = jstIso(newDate, newEnd);
    if (new Date(endsAt) <= new Date(startsAt)) {
      setError('終了時刻は開始時刻より後にしてください。');
      return;
    }
    setSaving(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('payment_visit_slots')
      .insert({ starts_at: startsAt, ends_at: endsAt, note: newNote.trim() || null });
    if (insertError) setError(insertError.message);
    else {
      setNewNote('');
      await reload();
    }
    setSaving(false);
  };

  const toggleActive = async (slot: PaymentVisitSlot) => {
    setError(null);
    const { error: updateError } = await supabase
      .from('payment_visit_slots')
      .update({ is_active: !slot.is_active })
      .eq('id', slot.id);
    if (updateError) setError(updateError.message);
    else await reload();
  };

  const deleteSlot = async (slot: PaymentVisitSlot) => {
    if ((upcomingCounts[slot.id] || 0) > 0) {
      setError('この日時を選んだ予約があるため削除できません。「受付停止」にしてください。');
      return;
    }
    if (!confirm(`${formatVisitSlot(slot)} を削除しますか？`)) return;
    setError(null);
    const { error: deleteError } = await supabase.from('payment_visit_slots').delete().eq('id', slot.id);
    if (deleteError) {
      setError(deleteError.code === '23503'
        ? 'この日時を選んだ予約（キャンセル済みを含む）があるため削除できません。「受付停止」にしてください。'
        : deleteError.message);
    } else await reload();
  };

  if (authLoading || loading) return <div style={{ padding: 60, textAlign: 'center' }}><div className="loading-spinner" /></div>;

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <main style={{ display: 'grid', gap: 20 }}>
          {error && <div className="error-banner">{error}</div>}

          <div className="glass-card">
            <h1 style={{ marginTop: 0 }}>委員会室 支払い受付</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              予約時に学生が選んだ来室日時ごとの一覧です。支払いを受け取ったら「支払い済みにする」を押してください。
              選んだ枠の終了時刻を過ぎても未払いの予約は、自動でキャンセルされます。
            </p>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setDateKey((key) => shiftDate(key, -1))}>← 前日</button>
              <input type="date" className="form-input" style={{ width: 'auto' }} value={dateKey} onChange={(e) => e.target.value && setDateKey(e.target.value)} />
              <button className="btn btn-secondary btn-sm" onClick={() => setDateKey((key) => shiftDate(key, 1))}>翌日 →</button>
              <button className="btn btn-secondary btn-sm" onClick={() => setDateKey(jstDateKey(new Date()))}>今日</button>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
              <div className="glass-card" style={{ padding: '12px 18px' }}><small style={{ color: 'var(--text-secondary)' }}>来室予定</small><div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{summary.total}人</div></div>
              <div className="glass-card" style={{ padding: '12px 18px' }}><small style={{ color: 'var(--text-secondary)' }}>支払い済み</small><div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{summary.paid}人</div></div>
              <div className="glass-card" style={{ padding: '12px 18px' }}><small style={{ color: 'var(--text-secondary)' }}>未払い</small><div style={{ fontSize: '1.6rem', fontWeight: 900 }}>{summary.pending}人</div></div>
            </div>

            {daySlots.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>この日の受付枠はありません。</p>}

            <div style={{ display: 'grid', gap: 16 }}>
              {daySlots.map((slot) => {
                const slotRows = rows.filter((row) => row.payment_visit_slot_id === slot.id);
                const count = slotRows.filter(isCounted).length;
                return (
                  <div key={slot.id} className="glass-card" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                      <strong style={{ fontSize: '1.05rem' }}>{formatVisitSlot(slot)}{slot.note && <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>（{slot.note}）</span>}</strong>
                      <span className="badge badge-success">{count}人</span>
                    </div>
                    {slotRows.length === 0 ? (
                      <p style={{ color: 'var(--text-secondary)', margin: 0 }}>この枠を選んだ予約はありません。</p>
                    ) : (
                      <div className="admin-table-container reservations-table-desktop">
                        <table className="admin-table">
                          <thead><tr><th>氏名</th><th>学籍番号</th><th>企画</th><th>支払い状態</th><th>操作</th></tr></thead>
                          <tbody>
                            {slotRows.map((row) => (
                              <tr key={row.id} style={{ opacity: row.status === 'cancelled' ? 0.5 : 1 }}>
                                <td>{row.student_name}</td>
                                <td>{row.student_number}</td>
                                <td>{row.events?.title || '―'}</td>
                                <td><strong>{paymentLabels[row.payment_status]}</strong>{row.status === 'cancelled' ? '（キャンセル済み）' : ''}</td>
                                <td>
                                  {row.status !== 'cancelled' && row.payment_status !== 'not_required' && (
                                    row.payment_status === 'paid'
                                      ? <button className="btn btn-secondary btn-sm" disabled={updatingId === row.id} onClick={() => setPaid(row.id, false)}>未払いに戻す</button>
                                      : <button className="btn btn-primary btn-sm" disabled={updatingId === row.id} onClick={() => setPaid(row.id, true)}>支払い済みにする</button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-card">
            <h2 style={{ marginTop: 0, fontSize: '1.25rem' }}>受付枠の追加</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              ここで作った枠は全企画共通です。支払い設定で「予約時に委員会室で支払う日時を選ばせる」をONにした企画の予約画面に表示されます。
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="visit-date">日付</label>
                <input id="visit-date" type="date" className="form-input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="visit-start">開始</label>
                <input id="visit-start" type="time" className="form-input" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label" htmlFor="visit-end">終了</label>
                <input id="visit-end" type="time" className="form-input" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
              </div>
              <div className="form-group" style={{ margin: 0, flex: '1 1 200px' }}>
                <label className="form-label" htmlFor="visit-note">メモ（任意・学生にも表示）</label>
                <input id="visit-note" type="text" className="form-input" placeholder="例：昼休み" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
              </div>
              <button className="btn btn-primary" onClick={addSlot} disabled={saving}>{saving ? '追加中...' : '追加する'}</button>
            </div>
          </div>

          <div className="glass-card">
            <h2 style={{ marginTop: 0, fontSize: '1.25rem' }}>これからの受付枠</h2>
            {upcoming.length === 0 ? (
              <p style={{ color: 'var(--text-secondary)' }}>これからの受付枠はありません。</p>
            ) : (
              <div className="admin-table-container reservations-table-desktop">
                <table className="admin-table">
                  <thead><tr><th>日時</th><th>メモ</th><th>予約人数</th><th>状態</th><th>操作</th></tr></thead>
                  <tbody>
                    {upcoming.map((slot) => (
                      <tr key={slot.id} style={{ opacity: slot.is_active ? 1 : 0.55 }}>
                        <td>{formatVisitSlot(slot)}</td>
                        <td>{slot.note || '―'}</td>
                        <td>{upcomingCounts[slot.id] || 0}人</td>
                        <td>{slot.is_active ? '受付中' : '受付停止'}</td>
                        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => toggleActive(slot)}>{slot.is_active ? '受付停止' : '受付再開'}</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteSlot(slot)}>削除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
