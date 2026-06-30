'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

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
  });
}

export default function AdminReservationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useAdminAuth();

  const [eventTitle, setEventTitle] = useState('');
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Modals / Actions
  const [cancellingId, setCancellingId] = useState<string | null>(null);
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
      console.error('Error cancelling reservation:', err);
      setError('キャンセル処理中にエラーが発生しました。');
    } finally {
      setCancellingId(null);
    }
  };

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

  // CSV Exporter (UTF-8 with BOM for Excel compatibility)
  const handleExportCSV = () => {
    if (reservations.length === 0) {
      alert('エクスポートする予約データがありません。');
      return;
    }

    const headers = [
      '予約日時',
      '券種',
      '氏名',
      '学籍番号',
      '開催枠',
      '大学メール',
      '予約状態',
      '使用状況',
      '使用日時',
    ];

    const rows = reservations.map((res) => {
      let statusLabel = '予約完了';
      if (res.status === 'used') statusLabel = '使用済み';
      if (res.status === 'cancelled') statusLabel = 'キャンセル済み';

      return [
        formatDateTime(res.created_at),
        res.ticket_type === 'walkin' ? '当日券' : '予約券',
        res.student_name,
        res.student_number,
        res.event_slots?.label || '-',
        res.university_email,
        statusLabel,
        res.status === 'used' ? '使用済み' : '未使用',
        formatDateTime(res.used_at),
      ];
    });

    const csvContent =
      headers.join(',') +
      '\n' +
      rows.map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');

    // Excel support: add BOM header (\ufeff)
    const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csvContent], {
      type: 'text/csv;charset=utf-8;',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    
    // Format file name
    const timestamp = new Date().toISOString().slice(0, 10);
    link.setAttribute('download', `reservations_${eventTitle.replace(/[\s/]/g, '_')}_${timestamp}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  // Statistics
  const totalBookings = reservations.length;
  const activeBookings = reservations.filter((r) => r.status !== 'cancelled').length;
  const usedTickets = reservations.filter((r) => r.status === 'used').length;
  const cancelledBookings = reservations.filter((r) => r.status === 'cancelled').length;

  return (
    <div className="admin-mode">
      <AdminNav />

      <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Link href="/admin/events" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          ← 企画一覧に戻る
        </Link>
      </div>

      <div className="glass-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
        <h1 style={{ fontSize: '1.4rem', color: '#fff' }}>{eventTitle}</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
          予約者一覧と利用実績データの確認・エクスポートが行えます。
        </p>

        {/* Status Blocks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', marginTop: '20px' }}>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>有効予約数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)' }}>{activeBookings}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>使用済み数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-success)' }}>{usedTickets}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>キャンセル数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-danger)' }}>{cancelledBookings}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>総ログ件数</span>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>{totalBookings}</div>
          </div>
        </div>

        {/* Action Panel */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '24px', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleExportCSV}
            style={{ width: 'auto' }}
          >
            📥 CSVファイルを出力
          </button>
          
          <button
            className="btn btn-danger btn-sm"
            onClick={() => setShowWipeModal(true)}
            style={{ width: 'auto', marginLeft: 'auto' }}
          >
            🗑️ 予約データの完全削除
          </button>
        </div>
      </div>

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
      ) : (
        <div className="admin-table-container">
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
              {reservations.map((res) => {
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
                    <td style={{ fontWeight: 700, color: '#fff' }}>{res.student_name}</td>
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
  );
}
