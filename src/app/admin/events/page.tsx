'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

interface EventAdminItem {
  id: string;
  title: string;
  capacity: number;
  is_public: boolean;
  reservation_enabled: boolean;
  ticket_enabled: boolean;
  starts_at: string | null;
  reservations: { id: string; status: string }[];
  event_slots?: { id: string; total_capacity: number }[];
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '未設定';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminEventsPage() {
  // 1. Verify authorization
  const { loading: authLoading, user } = useAdminAuth();
  
  const [events, setEvents] = useState<EventAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEvents = async () => {
    try {
      // Fetch all events along with their reservations and slots
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('*, reservations(id, status), event_slots(id, total_capacity)')
        .order('created_at', { ascending: false });

      if (fetchError) {
        setError(fetchError.message || '企画一覧の取得に失敗しました。');
        return;
      }

      setEvents(data as EventAdminItem[] || []);
    } catch (err) {
      console.error('Error fetching admin events:', err);
      setError('データの取得中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      fetchEvents();
    }
  }, [authLoading, user]);

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>管理者ダッシュボードを読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
      <AdminNav />

      <div>
      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', color: '#fff' }}>企画一覧・管理</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
              委員会で実施する企画の作成、公開設定、予約状況の確認ができます。
            </p>
          </div>
          <div>
            <Link href="/admin/events/new">
              <button className="btn btn-primary btn-sm">➕ 新規企画を追加</button>
            </Link>
          </div>
        </div>
      </div>

      {error && (
        <div className="error-banner">
          <span>⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {events.length === 0 ? (
        <div className="glass-card text-center" style={{ padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>企画がまだ登録されていません</p>
          <p style={{ fontSize: '0.875rem', marginBottom: '20px' }}>右上のボタンから最初の企画を作成してください。</p>
          <Link href="/admin/events/new">
            <button className="btn btn-primary" style={{ width: 'auto' }}>企画作成フォームへ</button>
          </Link>
        </div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>企画名</th>
                <th>開催日時</th>
                <th>公開設定</th>
                <th>予約受付</th>
                <th>チケット</th>
                <th>予約状況 (有効/定員)</th>
                <th style={{ textAlign: 'center' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const activeReservationsCount = event.reservations.filter(
                  (r) => r.status !== 'cancelled'
                ).length;
                
                const totalCapacity = event.event_slots && event.event_slots.length > 0
                  ? event.event_slots.reduce((sum, s) => sum + (s.total_capacity ?? 0), 0)
                  : event.capacity;

                const hasSlots = event.event_slots && event.event_slots.length > 0;

                return (
                  <tr key={event.id}>
                    <td style={{ fontWeight: 700, color: '#fff' }}>
                      {event.title}
                      {!hasSlots && (
                        <span className="badge badge-danger" style={{ marginLeft: '8px', background: 'var(--color-danger)', color: '#fff' }}>
                          ⚠️ 開催枠なし
                        </span>
                      )}
                    </td>
                    <td>{formatDateTime(event.starts_at)}</td>
                    <td>
                      {event.is_public ? (
                        <span className="badge badge-success">公開中</span>
                      ) : (
                        <span className="badge badge-danger">非公開</span>
                      )}
                    </td>
                    <td>
                      {event.reservation_enabled ? (
                        <span className="badge badge-success">受付中</span>
                      ) : (
                        <span className="badge badge-danger">停止</span>
                      )}
                    </td>
                    <td>
                      {event.ticket_enabled ? (
                        <span className="badge badge-success">あり</span>
                      ) : (
                        <span className="badge badge-secondary">なし</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontWeight: 700, color: activeReservationsCount >= totalCapacity ? 'var(--color-danger)' : 'var(--color-success)' }}>
                        {activeReservationsCount}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}> / {totalCapacity}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <Link href={`/admin/events/${event.id}`}>
                          <button className="btn btn-secondary btn-sm" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                            ⚙️ 編集
                          </button>
                        </Link>
                        <Link href={`/admin/events/${event.id}/reservations`}>
                          <button className="btn btn-secondary btn-sm" style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'var(--color-primary-hover)' }}>
                            👥 予約者 ({activeReservationsCount})
                          </button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
