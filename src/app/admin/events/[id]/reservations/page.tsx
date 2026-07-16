'use client';


import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';
import * as XLSX from 'xlsx';

interface ReservationItem {
  id: string;
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

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

interface AdminEventSlot {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  is_enabled: boolean;
  total_capacity: number;
  reservation_capacity: number;
  reserved_count: number;
  walkin_count: number;
  remaining_reservation_slots: number;
  remaining_walkin_slots: number;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  ticket_use_starts_at: string | null;
  ticket_use_ends_at: string | null;
  walkin_starts_at: string | null;
  walkin_ends_at: string | null;
  is_reservation_enabled: boolean;
  is_ticket_use_enabled: boolean;
  is_walkin_enabled: boolean;
  walkin_limit: number | null;
}

export default function AdminReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useAdminAuth();

  const [eventTitle, setEventTitle] = useState('');
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [slots, setSlots] = useState<AdminEventSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals / Actions
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wiping, setWiping] = useState(false);

  const loadData = async () => {
    try {
      // 1. Fetch Event Title
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('title')
        .eq('id', id)
        .single();

      if (eventError || !eventData) {
        setError('企画情報が見つかりません。');
        setLoading(false);
        return;
      }
      setEventTitle(eventData.title);

      // 2. Fetch Reservations with slot label
      const { data: resData, error: resError } = await supabase
        .from('reservations')
        .select('*, event_slots(label)')
        .eq('event_id', id)
        .order('created_at', { ascending: false });

      if (resError) {
        setError(resError.message || '予約者一覧の取得に失敗しました。');
        setLoading(false);
        return;
      }

      setReservations(resData as unknown as ReservationItem[] || []);

      // 3. Fetch Event Slots for breakdown statistics
      const { data: slotsData, error: slotsError } = await supabase.rpc('get_event_slots', {
        p_event_id: id,
      });

      if (slotsError) {
        console.error('Error fetching event slots:', slotsError);
      } else {
        setSlots(slotsData as AdminEventSlot[] || []);
      }

    } catch (err) {
      console.error('Error loading reservation logs:', err);
      setError('データの読み込み中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadData();
    }
  }, [id, authLoading, user]);

  const handleCancelReservation = async (reservationId: string) => {
    if (!confirm('本当にこの予約をキャンセルしますか？')) return;
    setError(null);
    setCancellingId(reservationId);

    try {
      const { error: cancelError } = await supabase
        .from('reservations')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', reservationId);

      if (cancelError) {
        setError(cancelError.message || 'キャンセルの更新に失敗しました。');
        setCancellingId(null);
        return;
      }

      // Reload lists
      await loadData();
    } catch (err) {
      console.error('Error in cancellation:', err);
      setError('予期せぬエラーが発生しました。');
      setCancellingId(null);
    }
  };

  const filteredReservations = reservations.filter((res) => {
    if (!searchQuery.trim()) return true;
    
    const query = searchQuery.trim().toLowerCase();
    
    // Name (ignore leading/trailing spaces)
    const nameStr = res.student_name ? res.student_name.trim().toLowerCase() : '';
    // Student Number (ignore case, ignore leading/trailing spaces)
    const noStr = res.student_number ? res.student_number.trim().toLowerCase() : '';
    
    return nameStr.includes(query) || noStr.includes(query);
  });

  const handleWipeData = async () => {
    setError(null);
    setWiping(true);

    try {
      // Wipe all reservations for this event
      const { error: wipeError } = await supabase
        .from('reservations')
        .delete()
        .eq('event_id', id);

      if (wipeError) {
        setError(wipeError.message || 'データ削除処理に失敗しました。');
        setWiping(false);
        return;
      }

      setShowWipeModal(false);
      setReservations([]);
      alert('すべての予約データを削除しました。');
    } catch (err) {
      console.error('Error wiping reservations:', err);
      setError('予約データ削除処理中にエラーが発生しました。');
    } finally {
      setWiping(false);
    }
  };

  // Excel Exporter
  const handleExportExcel = () => {
    // Export all reservations excluding cancelled
    const activeReservations = reservations.filter(r => r.status !== 'cancelled');
    
    if (activeReservations.length === 0) {
      alert('エクスポートする有効な予約データがありません。');
      return;
    }

    const headers = [
      '企画名',
      '氏名',
      '学籍番号',
      '開催枠',
    ];

    const rows = activeReservations.map((res) => [
      eventTitle,
      res.student_name || '',
      res.student_number || '',
      res.event_slots?.label || '-',
    ]);

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Reservations');

    const timestamp = new Date().toISOString().slice(0, 10);
    const fileName = `reservations_${eventTitle.replace(/[\s/]/g, '_')}_${timestamp}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  };

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  // Statistics: only count capacity-consuming/valid statuses (reserved, used)
  const totalBookings = reservations.length;
  const activeBookings = reservations.filter((r) => r.status === 'reserved' || r.status === 'used').length;
  const usedTickets = reservations.filter((r) => r.status === 'used').length;
  const cancelledBookings = reservations.filter((r) => r.status === 'cancelled').length;

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
      <AdminNav />

      <div>

      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/admin/events" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          ← 企画一覧に戻る
        </Link>
      </div>

      <div className="glass-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: '24px' }}>
              <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                予約者一覧
              </h1>
              <span className="badge" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>
                {filteredReservations.length} / {reservations.length}件表示
              </span>
            </div>
            <p style={{ color: 'var(--text-secondary)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              {eventTitle}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="search-box" style={{ minWidth: '300px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="氏名・学籍番号で検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            <button 
              onClick={handleExportExcel} 
              className="btn btn-secondary"
              disabled={loading || filteredReservations.length === 0}
              style={{ padding: '10px 16px', minWidth: '150px' }}
            >
              📥 Excel出力
            </button>
          </div>
        </div>

        {/* Status Blocks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginTop: '20px' }}>
          <div style={{ background: 'var(--card-bg)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>有効予約数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)' }}>{activeBookings}</div>
          </div>
          <div style={{ background: 'var(--card-bg)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>使用済み数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-success)' }}>{usedTickets}</div>
          </div>
          <div style={{ background: 'var(--card-bg)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>キャンセル数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-danger)' }}>{cancelledBookings}</div>
          </div>
          <div style={{ background: 'var(--card-bg)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>総ログ件数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{totalBookings}</div>
          </div>
        </div>

        {/* Action Panel */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setShowWipeModal(true)}
            style={{ width: 'auto', marginLeft: 'auto' }}
          >
            🗑️ 予約データの完全削除
          </button>
        </div>
      </div>

      {/* Slots Breakdown Table */}
      {slots.length > 0 && (
        <div className="glass-card" style={{ marginTop: '20px' }}>
          <h2 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>📊</span> 開催枠ごとの内訳
          </h2>
          <div className="admin-table-container" style={{ margin: 0 }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>枠名</th>
                  <th>開催日時</th>
                  <th style={{ textAlign: 'center' }}>定員</th>
                  <th style={{ textAlign: 'center' }}>予約券残席 / 発行数</th>
                  <th style={{ textAlign: 'center' }}>当日券残席 / 発行数</th>
                  <th style={{ textAlign: 'center' }}>当日券上限</th>
                  <th style={{ textAlign: 'center' }}>有効発行数</th>
                  <th>事前予約受付期間</th>
                  <th>当日券発行期間</th>
                </tr>
              </thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.label}</td>
                    <td style={{ fontSize: '0.8rem' }}>
                      {s.starts_at ? formatDateTime(s.starts_at).slice(5) : '-'} 〜 {s.ends_at ? formatDateTime(s.ends_at).slice(11) : '-'}
                    </td>
                    <td style={{ textAlign: 'center' }}>{s.total_capacity}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ color: s.remaining_reservation_slots > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>
                        {s.remaining_reservation_slots}
                      </span> / {s.reserved_count}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ color: s.remaining_walkin_slots > 0 ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 700 }}>
                        {s.remaining_walkin_slots}
                      </span> / {s.walkin_count}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {s.walkin_limit !== null ? s.walkin_limit : '制限なし'}
                    </td>
                    <td style={{ textAlign: 'center', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {s.reserved_count + s.walkin_count}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {s.is_reservation_enabled ? (
                        <>
                          {s.reservation_starts_at ? formatDateTime(s.reservation_starts_at).slice(5) : '制限なし'} 〜 <br />
                          {s.reservation_ends_at ? formatDateTime(s.reservation_ends_at).slice(5) : '制限なし'}
                        </>
                      ) : (
                        <span style={{ color: 'var(--color-danger)' }}>無効</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {s.is_walkin_enabled ? (
                        <>
                          {s.walkin_starts_at ? formatDateTime(s.walkin_starts_at).slice(5) : '制限なし'} 〜 <br />
                          {s.walkin_ends_at ? formatDateTime(s.walkin_ends_at).slice(5) : '制限なし'}
                        </>
                      ) : (
                        <span style={{ color: 'var(--color-danger)' }}>無効</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <span>⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {reservations.length === 0 ? (
        <div className="glass-card text-center" style={{ padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>予約者が登録されていません</p>
          <p style={{ fontSize: '0.875rem' }}>現在この企画には予約されたチケットはありません。</p>
        </div>
      ) : filteredReservations.length === 0 ? (
        <div className="glass-card text-center" style={{ padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>検索結果がありません</p>
          <p style={{ fontSize: '0.875rem' }}>条件に一致する予約者が見つかりませんでした。</p>
        </div>
      ) : (
        <>
        <div className="admin-table-container reservations-table-desktop">
          <table className="admin-table">
            <thead>
              <tr>
                <th>予約日時</th>
                <th>券種</th>
                <th>氏名</th>
                <th>学籍番号</th>
                <th>開催枠</th>
                <th>大学メールアドレス</th>
                <th>チケット状態</th>
                <th>使用時刻</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredReservations.map((res) => {
                const isItemReserved = res.status === 'reserved';
                const isItemUsed = res.status === 'used';
                const isItemCancelled = res.status === 'cancelled';

                return (
                  <tr key={res.id} style={{ opacity: isItemCancelled ? 0.4 : 1 }}>
                    <td>{formatDateTime(res.created_at)}</td>
                    <td>
                      {res.ticket_type === 'walkin' ? (
                        <span className="badge" style={{ backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderColor: 'var(--color-warning-border)' }}>当日券</span>
                      ) : (
                        <span className="badge" style={{ backgroundColor: 'var(--color-primary-glow)', color: 'var(--color-primary)', borderColor: 'var(--card-border-hover)' }}>予約券</span>
                      )}
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{res.student_name}</td>
                    <td>{res.student_number}</td>
                    <td>{res.event_slots?.label || '-'}</td>
                    <td style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{res.university_email}</td>
                    <td>
                      {isItemReserved && <span className="badge badge-success">有効</span>}
                      {isItemUsed && <span className="badge badge-warning">使用済み</span>}
                      {isItemCancelled && <span className="badge badge-danger">キャンセル</span>}
                    </td>
                    <td>{res.used_at ? formatDateTime(res.used_at) : '-'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {!isItemCancelled ? (
                        <button
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '4px 8px', fontSize: '0.75rem', borderColor: 'var(--color-danger-border)', color: 'var(--color-danger)' }}
                          onClick={() => handleCancelReservation(res.id)}
                          disabled={cancellingId === res.id}
                        >
                          {cancellingId === res.id ? 'キャンセル中...' : '❌ 取消'}
                        </button>
                      ) : (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>取消済</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile card view */}
        <div className="reservations-cards-mobile" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {reservations.map((res) => {
            const isItemCancelled = res.status === 'cancelled';
            const isItemUsed = res.status === 'used';
            const isItemReserved = res.status === 'reserved';
            return (
              <div key={res.id} className="glass-card" style={{ padding: '16px', opacity: isItemCancelled ? 0.5 : 1, marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {res.ticket_type === 'walkin' ? (
                      <span className="badge" style={{ backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderColor: 'var(--color-warning-border)', fontSize: '0.65rem' }}>当日券</span>
                    ) : (
                      <span className="badge" style={{ backgroundColor: 'var(--color-primary-glow)', color: 'var(--color-primary)', borderColor: 'var(--card-border-hover)', fontSize: '0.65rem' }}>予約券</span>
                    )}
                    {isItemReserved && <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>有効</span>}
                    {isItemUsed && <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>使用済み</span>}
                    {isItemCancelled && <span className="badge badge-danger" style={{ fontSize: '0.65rem' }}>キャンセル</span>}
                  </div>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{formatDateTime(res.created_at)}</span>
                </div>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{res.student_name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  学籍番号: {res.student_number} / 枠: {res.event_slots?.label || '-'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px', fontFamily: 'monospace' }}>
                  {res.university_email}
                </div>
                {res.used_at && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginTop: '4px' }}>
                    使用: {formatDateTime(res.used_at)}
                  </div>
                )}
                {!isItemCancelled && (
                  <div style={{ marginTop: '8px', textAlign: 'right' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '4px 8px', fontSize: '0.7rem', borderColor: 'var(--color-danger-border)', color: 'var(--color-danger)' }}
                      onClick={() => handleCancelReservation(res.id)}
                      disabled={cancellingId === res.id}
                    >
                      {cancellingId === res.id ? 'キャンセル中...' : '❌ 取消'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}

      {/* Wipe confirmation modal */}
      {showWipeModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ borderColor: 'var(--color-danger-border)' }}>
            <h3 className="modal-title" style={{ color: 'var(--color-danger)' }}>
              <span>⚠️</span> 予約データの完全削除
            </h3>
            <div className="modal-body">
              <strong>警告：この企画のすべての予約データおよび個人情報（氏名、学籍番号、メールアドレス、チケットコードなど）をデータベースから完全に削除します。</strong>
              <br /><br />
              一度削除するとデータを復元することはできません。学園祭や企画が完全に終了し、統計データなどをCSV保存した後に実行してください。
              <br /><br />
              本当に削除しますか？
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowWipeModal(false)}
                disabled={wiping}
              >
                キャンセル
              </button>
              <button
                className="btn btn-danger"
                onClick={handleWipeData}
                disabled={wiping}
              >
                {wiping ? '削除実行中...' : 'はい、完全に削除します'}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
