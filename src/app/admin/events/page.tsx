'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  ends_at: string | null;
  reservations: { id: string; status: string, ticket_type: string }[];
  admin_pre_registrations: { id: string; status: string, ticket_type: string }[];
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
  const { loading: authLoading, user } = useAdminAuth();
  const router = useRouter();
  
  const [events, setEvents] = useState<EventAdminItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'upcoming' | 'draft' | 'ended'>('active');

  // Restore modal state
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreData, setRestoreData] = useState<any | null>(null);
  const [restoreType, setRestoreType] = useState<'config_only' | 'full'>('config_only');
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchEvents = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('events')
        .select('*, reservations(id, status, ticket_type), admin_pre_registrations(id, status, ticket_type), event_slots(id, total_capacity)')
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

  const handleDuplicate = async (eventId: string) => {
    if (!confirm('この企画とその設定（開催枠含む）を複製しますか？（予約者は複製されません）')) {
      return;
    }
    
    try {
      const { data, error } = await supabase.rpc('admin_duplicate_event', { p_event_id: eventId });
      
      if (error) throw error;
      
      alert('企画を複製しました。「下書き」タブを確認してください。');
      fetchEvents();
    } catch (err: any) {
      alert(`複製に失敗しました: ${err.message}`);
    }
  };

  const handleRestoreFileSelect = async (file: File) => {
    setRestoreError(null);
    setRestoreData(null);
    setRestoreType('config_only');

    if (file.size > 10 * 1024 * 1024) {
      setRestoreError('ファイルサイズが10MBを超えています。');
      return;
    }

    if (!file.name.endsWith('.json')) {
      setRestoreError('JSONファイルのみ対応しています。');
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (parsed.schema_version !== '1.0') {
        setRestoreError(`未対応のスキーマバージョンです: ${parsed.schema_version || '不明'}`);
        return;
      }

      if (parsed.backup_type !== 'config_only' && parsed.backup_type !== 'full') {
        setRestoreError(`不正なバックアップ形式です: ${parsed.backup_type || '不明'}`);
        return;
      }

      if (!parsed.event || !parsed.event_slots) {
        setRestoreError('バックアップデータに必要なフィールド（event, event_slots）がありません。');
        return;
      }

      if (!Array.isArray(parsed.event_slots) || parsed.event_slots.length < 1) {
        setRestoreError('開催枠が1つ以上必要です。');
        return;
      }

      setRestoreFile(file);
      setRestoreData(parsed);
      setRestoreType(parsed.backup_type === 'full' ? 'full' : 'config_only');
    } catch (e) {
      setRestoreError('JSONの解析に失敗しました。ファイルが正しいか確認してください。');
    }
  };

  const handleRestoreConfirm = async () => {
    if (!restoreData) return;
    setRestoring(true);
    setRestoreError(null);

    try {
      const jsonToSend = { ...restoreData, backup_type: restoreType };
      const { data, error: rpcError } = await supabase.rpc('admin_restore_event_backup', { p_json: jsonToSend });

      if (rpcError) throw rpcError;

      const newEventId = data;
      alert('✅ バックアップから企画を復元しました。編集画面に移動します。');
      setShowRestoreModal(false);
      setRestoreFile(null);
      setRestoreData(null);
      setRestoreError(null);
      router.push(`/admin/events/${newEventId}`);
    } catch (err: any) {
      setRestoreError(`復元に失敗しました: ${err.message}`);
    } finally {
      setRestoring(false);
    }
  };

  const openRestoreModal = () => {
    setShowRestoreModal(true);
    setRestoreFile(null);
    setRestoreData(null);
    setRestoreError(null);
    setRestoreType('config_only');
    setRestoring(false);
  };

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>管理者ダッシュボードを読み込み中...</p>
      </div>
    );
  }

  const now = new Date();
  
  const categorizedEvents = {
    active: events.filter(e => e.is_public && e.starts_at && new Date(e.starts_at) <= now && (!e.ends_at || new Date(e.ends_at) >= now)),
    upcoming: events.filter(e => e.is_public && e.starts_at && new Date(e.starts_at) > now),
    draft: events.filter(e => !e.is_public),
    ended: events.filter(e => e.is_public && e.ends_at && new Date(e.ends_at) < now)
  };

  const renderEventTable = (eventList: EventAdminItem[]) => {
    if (eventList.length === 0) {
      return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-secondary)' }}>このカテゴリの企画はありません</div>;
    }
    
    return (
      <div className="admin-table-container">
        <table className="admin-table">
          <thead>
            <tr>
              <th>企画名</th>
              <th>開催日時</th>
              <th>公開設定</th>
              <th>予約受付</th>
              <th>予約状況 (有効/定員)</th>
              <th style={{ textAlign: 'center' }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {eventList.map((event) => {
              const activeReservationsCount = (event.reservations || []).filter(
                (r) => r.status !== 'cancelled'
              ).length;
              
              const activePreRegistrationsCount = (event.admin_pre_registrations || []).filter(
                (r) => r.status !== 'cancelled'
              ).length;
              
              const totalUsed = activeReservationsCount + activePreRegistrationsCount;
              
              const totalCapacity = event.event_slots && event.event_slots.length > 0
                ? event.event_slots.reduce((sum, s) => sum + (s.total_capacity ?? 0), 0)
                : event.capacity;

              const hasSlots = event.event_slots && event.event_slots.length > 0;

              return (
                <tr key={event.id}>
                  <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                    {event.title}
                    {!hasSlots && (
                      <span className="badge badge-danger" style={{ marginLeft: '8px', background: 'var(--color-danger)', color: 'var(--text-primary)' }}>
                        ⚠️ 枠未設定
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
                    <span style={{ fontWeight: 700, color: totalUsed >= totalCapacity ? 'var(--color-danger)' : 'var(--color-success)' }}>
                      {totalUsed}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}> / {totalCapacity}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <Link href={`/admin/events/${event.id}`}>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '6px 12px', fontSize: '0.8rem' }} title="設定を編集">
                          ⚙️ 編集
                        </button>
                      </Link>
                      <Link href={`/admin/events/${event.id}/pre-registrations`}>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'var(--color-warning-border)', color: 'var(--color-warning)' }} title="管理者による事前登録">
                          🎟️ 事前登録
                        </button>
                      </Link>
                      <Link href={`/admin/events/${event.id}/reservations`}>
                        <button className="btn btn-secondary btn-sm" style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'var(--color-primary-hover)' }} title="予約者一覧">
                          👥 予約者 ({totalUsed})
                        </button>
                      </Link>
                      <button 
                        className="btn btn-secondary btn-sm" 
                        style={{ padding: '6px 12px', fontSize: '0.8rem', borderColor: 'var(--color-surface-hover)' }}
                        onClick={() => handleDuplicate(event.id)}
                        title="企画を複製"
                      >
                        📄 複製
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
      <AdminNav />

      <div>
      <div className="glass-card" style={{ marginBottom: '24px' }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', color: 'var(--text-primary)' }}>企画一覧・管理</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
              委員会で実施する企画の作成、公開設定、予約状況の確認ができます。
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary btn-sm" onClick={openRestoreModal}>
              📦 バックアップから復元
            </button>
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
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-surface-hover)', backgroundColor: 'var(--color-surface)' }}>
            {(['active', 'upcoming', 'draft', 'ended'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '16px 24px',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid var(--color-primary)' : '2px solid transparent',
                  color: activeTab === tab ? 'var(--color-primary)' : 'var(--text-secondary)',
                  fontWeight: activeTab === tab ? 700 : 400,
                  cursor: 'pointer',
                  flex: 1,
                  transition: 'all 0.2s'
                }}
              >
                {tab === 'active' && `開催中・受付中 (${categorizedEvents.active.length})`}
                {tab === 'upcoming' && `開催予定 (${categorizedEvents.upcoming.length})`}
                {tab === 'draft' && `下書き (${categorizedEvents.draft.length})`}
                {tab === 'ended' && `終了済み (${categorizedEvents.ended.length})`}
              </button>
            ))}
          </div>
          {renderEventTable(categorizedEvents[activeTab])}
        </div>
      )}
      </div>
      </div>

      {/* Restore Modal */}
      {showRestoreModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            padding: '20px',
          }}
          onClick={() => !restoring && setShowRestoreModal(false)}
        >
          <div
            className="glass-card"
            style={{
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '28px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.25rem', color: 'var(--text-primary)', margin: 0 }}>📦 バックアップから復元</h2>
              <button
                onClick={() => !restoring && setShowRestoreModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: '1.5rem', cursor: 'pointer', padding: '4px' }}
                disabled={restoring}
              >
                ✕
              </button>
            </div>

            {restoreError && (
              <div style={{
                padding: '12px 16px',
                marginBottom: '16px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: 'var(--color-danger, #ef4444)',
                fontSize: '0.875rem',
              }}>
                ⚠️ {restoreError}
              </div>
            )}

            {!restoreData ? (
              /* File upload area */
              <div>
                <div
                  style={{
                    border: '2px dashed var(--card-border, rgba(255,255,255,0.15))',
                    borderRadius: '12px',
                    padding: '40px 20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                    backgroundColor: 'var(--color-surface, rgba(255,255,255,0.03))',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleRestoreFileSelect(file);
                  }}
                >
                  <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>📁</div>
                  <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '8px' }}>
                    バックアップファイルを選択
                  </p>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    クリックまたはドラッグ＆ドロップでJSONファイルを読み込みます
                  </p>
                  <p style={{ color: 'var(--text-muted, var(--text-secondary))', fontSize: '0.75rem', marginTop: '8px' }}>
                    対応形式: .json（最大10MB）
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleRestoreFileSelect(file);
                      e.target.value = '';
                    }}
                  />
                </div>
              </div>
            ) : (
              /* Confirmation screen */
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
                  <tbody>
                    {[
                      { label: '企画名', value: restoreData.event?.title || '不明' },
                      { label: 'バックアップ作成日時', value: restoreData.created_at ? new Date(restoreData.created_at).toLocaleString('ja-JP') : '不明' },
                      { label: 'バックアップ形式バージョン', value: restoreData.schema_version },
                      { label: 'バックアップ種別', value: restoreData.backup_type === 'full' ? '予約者情報あり' : '設定のみ' },
                      { label: '開催枠数', value: `${restoreData.event_slots?.length ?? 0} 枠` },
                      ...(restoreData.backup_type === 'full' ? [
                        {
                          label: '予約者数',
                          value: `${(restoreData.reservations?.length ?? 0) + (restoreData.admin_pre_registrations?.length ?? 0)} 件`,
                        },
                        {
                          label: '予約券数',
                          value: `${[
                            ...(restoreData.reservations || []),
                            ...(restoreData.admin_pre_registrations || []),
                          ].filter((r: any) => r.ticket_type === 'reservation').length} 件`,
                        },
                        {
                          label: '当日券数',
                          value: `${[
                            ...(restoreData.reservations || []),
                            ...(restoreData.admin_pre_registrations || []),
                          ].filter((r: any) => r.ticket_type === 'walkin').length} 件`,
                        },
                        {
                          label: '使用済み数',
                          value: `${[
                            ...(restoreData.reservations || []),
                            ...(restoreData.admin_pre_registrations || []),
                          ].filter((r: any) => r.status === 'used').length} 件`,
                        },
                      ] : []),
                    ].map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--card-border, rgba(255,255,255,0.08))' }}>
                        <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontSize: '0.85rem', whiteSpace: 'nowrap', width: '40%' }}>
                          {row.label}
                        </td>
                        <td style={{ padding: '10px 12px', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 600 }}>
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div style={{
                  padding: '12px 16px',
                  marginBottom: '20px',
                  borderRadius: '8px',
                  backgroundColor: 'rgba(234, 179, 8, 0.1)',
                  border: '1px solid rgba(234, 179, 8, 0.3)',
                  color: 'var(--color-warning, #eab308)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                }}>
                  ⚠ 復元された企画は非公開・受付停止の安全な状態で作成されます。日時を確認してから公開してください。
                </div>

                {/* Restore type selection */}
                <div style={{ marginBottom: '20px' }}>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '10px' }}>復元内容を選択：</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: `1px solid ${restoreType === 'config_only' ? 'var(--color-primary)' : 'var(--card-border, rgba(255,255,255,0.1))'}`,
                      backgroundColor: restoreType === 'config_only' ? 'rgba(59,130,246,0.08)' : 'transparent',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}>
                      <input
                        type="radio"
                        name="restoreType"
                        value="config_only"
                        checked={restoreType === 'config_only'}
                        onChange={() => setRestoreType('config_only')}
                      />
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>設定のみ復元</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>企画の設定と開催枠のみを復元します</div>
                      </div>
                    </label>
                    <label style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '12px 14px',
                      borderRadius: '8px',
                      border: `1px solid ${restoreType === 'full' ? 'var(--color-primary)' : 'var(--card-border, rgba(255,255,255,0.1))'}`,
                      backgroundColor: restoreType === 'full' ? 'rgba(59,130,246,0.08)' : 'transparent',
                      cursor: restoreData.backup_type === 'full' ? 'pointer' : 'not-allowed',
                      opacity: restoreData.backup_type === 'full' ? 1 : 0.4,
                      transition: 'all 0.2s',
                    }}>
                      <input
                        type="radio"
                        name="restoreType"
                        value="full"
                        checked={restoreType === 'full'}
                        onChange={() => setRestoreType('full')}
                        disabled={restoreData.backup_type !== 'full'}
                      />
                      <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.9rem' }}>設定＋予約者情報を復元</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                          {restoreData.backup_type === 'full'
                            ? '企画の設定、開催枠、予約者情報をすべて復元します'
                            : 'このバックアップには予約者情報が含まれていません'}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setRestoreData(null);
                      setRestoreFile(null);
                      setRestoreError(null);
                    }}
                    disabled={restoring}
                    style={{ padding: '10px 20px' }}
                  >
                    ← ファイル再選択
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleRestoreConfirm}
                    disabled={restoring}
                    style={{ padding: '10px 24px' }}
                  >
                    {restoring ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="loading-spinner" style={{ width: '16px', height: '16px' }}></span>
                        復元中...
                      </span>
                    ) : (
                      '✅ 復元を実行'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

