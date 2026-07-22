'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

interface ReservationItem {
  id: string;
  event_slot_id: string | null;
  student_name: string;
  student_number: string;
  university_email: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  used_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  event_slots: { label: string } | null;
}

interface AdminEventSlot {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  total_capacity: number;
  reservation_capacity: number;
  reserved_count: number;
  walkin_count: number;
  remaining_reservation_slots: number;
  remaining_walkin_slots: number;
  walkin_limit: number | null;
}

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function safeFileName(value: string): string {
  return value.replace(/[\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'event';
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

function formatSlotDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  });
}

export default function AdminReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useAdminAuth();
  const [eventTitle, setEventTitle] = useState('');
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [slots, setSlots] = useState<AdminEventSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wiping, setWiping] = useState(false);

  const loadData = async () => {
    try {
      setError(null);
      const { data: eventData, error: eventError } = await supabase
        .from('events').select('title').eq('id', id).single();
      if (eventError || !eventData) throw new Error('企画情報が見つかりません。');
      setEventTitle(eventData.title);

      const { data: resData, error: resError } = await supabase
        .from('reservations')
        .select('*, event_slots(label)')
        .eq('event_id', id)
        .order('created_at', { ascending: false });
      if (resError) throw resError;
      setReservations((resData as unknown as ReservationItem[]) || []);

      const { data: slotsData, error: slotsError } = await supabase.rpc('get_event_slots', { p_event_id: id });
      if (slotsError) throw slotsError;
      setSlots((slotsData as AdminEventSlot[]) || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'データの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) loadData();
  }, [id, authLoading, user]);

  const handleCopyEmails = async (includeUsed: boolean) => {
    const emails = Array.from(new Set(
      reservations
        .filter((res) => res.status !== 'cancelled' && (includeUsed || res.status === 'reserved'))
        .map((res) => res.university_email?.trim())
        .filter((email): email is string => Boolean(email)),
    ));
    if (emails.length === 0) {
      alert(includeUsed ? 'コピーできる予約者メールがありません。' : '未使用の予約者メールがありません。');
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(','));
      alert(`${emails.length}件のメールアドレスをコピーしました。`);
    } catch (copyError) {
      console.error(copyError);
      setError('メールアドレスのコピーに失敗しました。');
    }
  };

  const handleCancelReservation = async (reservationId: string) => {
    if (!confirm('本当にこの予約をキャンセルしますか？')) return;
    setCancellingId(reservationId);
    const { error: cancelError } = await supabase
      .from('reservations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', reservationId);
    if (cancelError) setError(cancelError.message);
    else await loadData();
    setCancellingId(null);
  };

  const handleWipeData = async () => {
    setWiping(true);
    const { error: wipeError } = await supabase.from('reservations').delete().eq('event_id', id);
    if (wipeError) setError(wipeError.message);
    else {
      setReservations([]);
      setShowWipeModal(false);
      alert('すべての予約データを削除しました。');
    }
    setWiping(false);
  };

  const handleExportCsv = () => {
    if (reservations.length === 0) return alert('エクスポートする予約データがありません。');
    const statusLabel = { reserved: '有効', used: '使用済み', cancelled: 'キャンセル' } as const;
    const typeLabel = { reservation: '予約券', walkin: '当日券' } as const;
    const headers = ['企画名', '開催枠', '券種', '氏名', '学籍番号', '大学メール', '状態', '申込日時', '使用日時', '取消日時', 'チケットコード'];
    const rows = reservations.map((res) => [
      eventTitle, res.event_slots?.label || '-', typeLabel[res.ticket_type], res.student_name,
      res.student_number, res.university_email, statusLabel[res.status], formatDateTime(res.created_at),
      res.used_at ? formatDateTime(res.used_at) : '', res.cancelled_at ? formatDateTime(res.cancelled_at) : '', res.ticket_code,
    ]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `reservations_${safeFileName(eventTitle)}_${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredReservations = reservations.filter((res) => {
    const query = searchQuery.trim().toLowerCase();
    return !query || res.student_name.toLowerCase().includes(query) || res.student_number.toLowerCase().includes(query);
  });

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0' }}><div className="loading-spinner" /></div>;
  }

  const activeBookings = reservations.filter((r) => r.status === 'reserved' || r.status === 'used').length;
  const unusedTickets = reservations.filter((r) => r.status === 'reserved').length;
  const usedTickets = reservations.filter((r) => r.status === 'used').length;
  const cancelledBookings = reservations.filter((r) => r.status === 'cancelled').length;

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div>
          <div style={{ marginBottom: 20 }}><Link href="/admin/events">← 企画一覧に戻る</Link></div>

          <div className="glass-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div><h1>予約者一覧</h1><p>{eventTitle}</p></div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <input className="form-input" placeholder="氏名・学籍番号で検索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <button onClick={handleExportCsv} className="btn btn-secondary">📥 CSV出力</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginTop: 20 }}>
              <div className="glass-card"><small>有効発行数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{activeBookings}</div><small>未使用＋使用済み</small></div>
              <div className="glass-card"><small>未使用数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{unusedTickets}</div><small>これから使用可能</small></div>
              <div className="glass-card"><small>使用済み数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{usedTickets}</div><small>すでに使用済み</small></div>
              <div className="glass-card"><small>キャンセル数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{cancelledBookings}</div><small>有効数には含まない</small></div>
              <div className="glass-card"><small>総記録件数</small><div style={{ fontSize: 28, fontWeight: 700 }}>{reservations.length}</div><small>有効＋キャンセル</small></div>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => handleCopyEmails(false)}>📋 未使用者メールをコピー</button>
              <button className="btn btn-secondary btn-sm" onClick={() => handleCopyEmails(true)}>📋 予約者全員のメールをコピー</button>
              <button className="btn btn-danger btn-sm" onClick={() => setShowWipeModal(true)} style={{ marginLeft: 'auto' }}>🗑️ 予約データの完全削除</button>
            </div>
          </div>

          {error && <div className="error-banner">⚠️ {error}</div>}

          {slots.length > 0 && (
            <div className="glass-card" style={{ marginTop: 20 }}>
              <h2 style={{ marginBottom: 6 }}>📊 開催枠ごとの発行状況</h2>
              <p style={{ marginTop: 0, opacity: 0.75 }}>実際の発行数、事前確保数、現在発行できる残りを分けて表示します。</p>

              <div className="admin-table-container">
                <table className="admin-table">
                  <thead><tr><th>開催枠</th><th>全体定員</th><th>予約券</th><th>当日券</th><th>全体</th></tr></thead>
                  <tbody>
                    {slots.map((s) => {
                      const slotActive = reservations.filter((r) => r.event_slot_id === s.id && r.status !== 'cancelled');
                      const reservationIssued = slotActive.filter((r) => r.ticket_type === 'reservation').length;
                      const walkinIssued = slotActive.filter((r) => r.ticket_type === 'walkin').length;
                      const reservationHeld = Math.max(s.reserved_count - reservationIssued, 0);
                      const walkinHeld = Math.max(s.walkin_count - walkinIssued, 0);
                      const occupied = reservationIssued + walkinIssued + reservationHeld + walkinHeld;
                      const totalRemaining = Math.max(s.total_capacity - occupied, 0);
                      const usageRate = s.total_capacity > 0 ? Math.min((occupied / s.total_capacity) * 100, 100) : 0;
                      const dynamicWalkinCapacity = walkinIssued + walkinHeld + s.remaining_walkin_slots;

                      return (
                        <tr key={s.id}>
                          <td>
                            <strong>{s.label}</strong>
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                              {formatSlotDateTime(s.starts_at)}〜{s.ends_at ? new Date(s.ends_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '-'}
                            </div>
                          </td>
                          <td><strong>{s.total_capacity}人</strong></td>
                          <td>
                            <div><strong>発行済み {reservationIssued}人</strong></div>
                            {reservationHeld > 0 && <div style={{ marginTop: 4 }}>事前確保 {reservationHeld}人</div>}
                            <div style={{ marginTop: 4 }}>予約枠上限 {s.reservation_capacity}人</div>
                            <div style={{ marginTop: 5, fontWeight: 700 }}>予約枠残り {s.remaining_reservation_slots}人</div>
                          </td>
                          <td>
                            <div><strong>発行済み {walkinIssued}人</strong></div>
                            {walkinHeld > 0 && <div style={{ marginTop: 4 }}>事前確保 {walkinHeld}人</div>}
                            <div style={{ marginTop: 4 }}>
                              {s.walkin_limit == null ? `動的上限（現在最大 ${dynamicWalkinCapacity}人）` : `固定上限 ${s.walkin_limit}人`}
                            </div>
                            <div style={{ marginTop: 5, fontWeight: 700 }}>今から発行可能 {s.remaining_walkin_slots}人</div>
                          </td>
                          <td style={{ minWidth: 180 }}>
                            <div><strong>占有 {occupied}人 / {s.total_capacity}人</strong></div>
                            <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                              <div style={{ width: `${usageRate}%`, height: '100%', background: 'var(--color-primary)', borderRadius: 999 }} />
                            </div>
                            <div style={{ marginTop: 5, fontSize: 12 }}>全体残り {totalRemaining}人（{usageRate.toFixed(1)}%）</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.04)', fontSize: 13, lineHeight: 1.7 }}>
                <strong>見方：</strong> 「発行済み」は予約データとして作成済みのチケットです。「事前確保」は管理者の事前登録で押さえている枠です。当日券の動的上限は、予約やキャンセルの増減に応じて全体残席から自動計算されます。
              </div>
            </div>
          )}

          <div className="admin-table-container reservations-table-desktop" style={{ marginTop: 20 }}>
            <table className="admin-table">
              <thead><tr><th>予約日時</th><th>券種</th><th>氏名</th><th>学籍番号</th><th>開催枠</th><th>大学メールアドレス</th><th>状態</th><th>操作</th></tr></thead>
              <tbody>
                {filteredReservations.map((res) => (
                  <tr key={res.id} style={{ opacity: res.status === 'cancelled' ? 0.4 : 1 }}>
                    <td>{formatDateTime(res.created_at)}</td>
                    <td>{res.ticket_type === 'walkin' ? '当日券' : '予約券'}</td>
                    <td>{res.student_name}</td>
                    <td>{res.student_number}</td>
                    <td>{res.event_slots?.label || '-'}</td>
                    <td>{res.university_email}</td>
                    <td>{res.status === 'reserved' ? '有効' : res.status === 'used' ? '使用済み' : 'キャンセル'}</td>
                    <td>{res.status !== 'cancelled' && <button className="btn btn-secondary btn-sm" onClick={() => handleCancelReservation(res.id)} disabled={cancellingId === res.id}>❌ 取消</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showWipeModal && (
            <div className="modal-overlay">
              <div className="modal-content">
                <h3>⚠️ 予約データの完全削除</h3>
                <p>この企画のすべての予約データを完全に削除します。本当に削除しますか？</p>
                <div className="modal-actions">
                  <button className="btn btn-secondary" onClick={() => setShowWipeModal(false)}>キャンセル</button>
                  <button className="btn btn-danger" onClick={handleWipeData} disabled={wiping}>{wiping ? '削除実行中...' : 'はい、完全に削除します'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
