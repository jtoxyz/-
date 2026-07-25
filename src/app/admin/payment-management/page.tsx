'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';

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
};

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

export default function PaymentManagementPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState('');
  const [rows, setRows] = useState<ReservationRow[]>([]);
  const [filter, setFilter] = useState<'all' | PaymentStatus>('all');
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
      .select('id,student_name,student_number,university_email,status,payment_status,payment_due_at,paid_at,created_at,event_id,event_slots(label)')
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

  const counts = useMemo(() => ({
    all: rows.length,
    pending: rows.filter((r) => r.payment_status === 'pending').length,
    paid: rows.filter((r) => r.payment_status === 'paid').length,
    expired: rows.filter((r) => r.payment_status === 'expired').length,
    not_required: rows.filter((r) => r.payment_status === 'not_required').length,
  }), [rows]);

  const visibleRows = useMemo(
    () => rows.filter((row) => filter === 'all' || row.payment_status === filter),
    [rows, filter]
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
              <div className="form-group" style={{ minWidth: 280, margin: 0 }}>
                <label className="form-label">企画</label>
                <select className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
                  {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
                </select>
              </div>
              <button className="btn btn-secondary" onClick={expireNow}>期限切れを今すぐ反映</button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
              {(['all','pending','paid','expired','not_required'] as const).map((key) => (
                <button key={key} className={`btn ${filter === key ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setFilter(key)}>
                  {key === 'all' ? '全件' : labels[key]} ({counts[key]})
                </button>
              ))}
            </div>

            {loading ? <div className="loading-spinner" /> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="reservations-table-desktop" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th>氏名</th><th>学籍番号</th><th>枠</th><th>支払い状態</th><th>期限</th><th>支払日時</th><th>操作</th></tr></thead>
                  <tbody>
                    {visibleRows.map((row) => (
                      <tr key={row.id} style={{ opacity: row.status === 'cancelled' ? 0.5 : 1 }}>
                        <td>{row.student_name}</td>
                        <td>{row.student_number}</td>
                        <td>{row.event_slots?.label || '―'}</td>
                        <td><strong>{labels[row.payment_status]}</strong>{row.status === 'cancelled' ? '（キャンセル済み）' : ''}</td>
                        <td>{formatDate(row.payment_due_at)}</td>
                        <td>{formatDate(row.paid_at)}</td>
                        <td>
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
