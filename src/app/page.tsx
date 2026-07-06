import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import MyTicketsList from '@/components/MyTicketsList';

// Opt out of static caching so reservation numbers are always real-time
export const revalidate = 0;
export const runtime = 'edge';

interface PublicEventSlot {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  total_capacity: number;
  reservation_capacity: number;
  is_enabled: boolean;
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

interface PublicEvent {
  id: string;
  title: string;
  description: string;
  capacity: number;
  starts_at: string | null;
  ends_at: string | null;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  reservation_enabled: boolean;
  remaining_slots: number;
  total_capacity: number;
  reservation_capacity: number;
  remaining_reservation_slots: number;
  remaining_walkin_slots: number;
  has_walkin_active: boolean;
  has_walkin_upcoming: boolean;
  slots: PublicEventSlot[];
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '制限なし';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) + ` (${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`;
}

export default async function Home() {
  // Fetch public events from Supabase secure RPC
  const { data: events, error } = await supabase.rpc('get_public_events');

  const now = new Date();

  const getEventStatus = (event: PublicEvent) => {
    // 0. 準備中（総参加枠が0）
    if (event.total_capacity === 0) {
      return { label: '準備中', buttonText: '準備中', active: false, badge: 'badge-secondary' };
    }

    const enabledSlots = event.slots?.filter(s => s.is_enabled) || [];

    // 1. 予約受付中かつ予約枠あり → 予約優先表示
    const hasReservationActive = enabledSlots.some(s => {
      if (!s.is_reservation_enabled || s.remaining_reservation_slots <= 0) return false;
      const starts = s.reservation_starts_at ? new Date(s.reservation_starts_at) : null;
      const ends = s.reservation_ends_at ? new Date(s.reservation_ends_at) : null;
      return (!starts || now >= starts) && (!ends || now <= ends);
    });

    if (hasReservationActive) {
      return { label: '予約受付中', buttonText: '予約フォームへ進む ➔', active: true, badge: 'badge-success' };
    }

    // 2. 予約受付前かつ予約枠あり
    const hasReservationUpcoming = enabledSlots.some(s => {
      if (!s.is_reservation_enabled || s.remaining_reservation_slots <= 0) return false;
      const starts = s.reservation_starts_at ? new Date(s.reservation_starts_at) : null;
      return starts && now < starts;
    });

    if (hasReservationUpcoming) {
      return { label: '予約受付前', buttonText: '詳細を見る ➔', active: true, badge: 'badge-secondary' };
    }

    // 3. 当日券受付中かつ当日券残あり
    const hasWalkinActive = enabledSlots.some(s => {
      if (!s.is_walkin_enabled || s.remaining_walkin_slots <= 0) return false;
      const starts = s.walkin_starts_at ? new Date(s.walkin_starts_at) : null;
      const ends = s.walkin_ends_at ? new Date(s.walkin_ends_at) : null;
      return (!starts || now >= starts) && (!ends || now <= ends);
    });

    if (hasWalkinActive) {
      return { label: '当日券受付中', buttonText: '当日券を取得する ➔', active: true, badge: 'badge-warning' };
    }

    // 4. 当日券受付前だが当日券残あり
    const hasWalkinUpcoming = enabledSlots.some(s => {
      if (!s.is_walkin_enabled || s.remaining_walkin_slots <= 0) return false;
      const starts = s.walkin_starts_at ? new Date(s.walkin_starts_at) : null;
      return starts && now < starts;
    });

    if (hasWalkinUpcoming) {
      return { label: '当日券受付前', buttonText: '詳細を見る ➔', active: true, badge: 'badge-warning' };
    }

    // 5. 定員到達（予約枠も当日枠も満員）
    if (event.remaining_walkin_slots <= 0 && event.remaining_reservation_slots <= 0) {
      return { label: '定員到達', buttonText: '定員到達', active: false, badge: 'badge-danger' };
    }

    // 6. 予約も当日券も受付不可（期間外または終了）
    return { label: '受付終了', buttonText: '受付終了', active: false, badge: 'badge-danger' };
  };

  return (
    <div>
      <div className="text-center" style={{ marginBottom: '32px' }}>
        <h1 className="page-title">委員会企画予約</h1>
        <p className="page-subtitle">学内向け参加型企画の予約・電子チケット管理ポータル</p>
      </div>

      {/* Cached ticket links on user device */}
      <MyTicketsList />

      <h2 style={{ fontSize: '1.4rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>📅</span> 公開中の企画一覧
      </h2>

      {error && (
        <div className="error-banner">
          <span>⚠️</span>
          <div>企画一覧の取得に失敗しました。時間をおいて再度お試しください。</div>
        </div>
      )}

      {!error && (!events || events.length === 0) && (
        <div className="glass-card text-center" style={{ padding: '40px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '1.2rem', marginBottom: '8px' }}>現在公開中の企画はありません</p>
          <p style={{ fontSize: '0.875rem' }}>企画が追加されるまでしばらくお待ちください。</p>
        </div>
      )}

      {events && events.length > 0 && (
        <div className="events-grid">
          {events.map((event: PublicEvent) => {
            const status = getEventStatus(event);
            
            const enabledSlots = event.slots?.filter(s => s.is_enabled) || [];

            const hasWalkinActive = enabledSlots.some(s => {
              if (!s.is_walkin_enabled || s.remaining_walkin_slots <= 0) return false;
              const starts = s.walkin_starts_at ? new Date(s.walkin_starts_at) : null;
              const ends = s.walkin_ends_at ? new Date(s.walkin_ends_at) : null;
              return (!starts || now >= starts) && (!ends || now <= ends);
            });

            const hasWalkinUpcoming = !hasWalkinActive && enabledSlots.some(s => {
              if (!s.is_walkin_enabled || s.remaining_walkin_slots <= 0) return false;
              const starts = s.walkin_starts_at ? new Date(s.walkin_starts_at) : null;
              return starts && now < starts;
            });

            return (
              <div key={event.id} className="glass-card interactive">
                <div className="flex-between" style={{ marginBottom: '12px', alignItems: 'flex-start' }}>
                  <span className={`badge ${status.badge}`}>{status.label}</span>
                  <div style={{ textAlign: 'right', fontSize: '0.78rem', lineHeight: '1.4' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      予約券残り: <span style={{ fontWeight: 700, color: event.remaining_reservation_slots > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>{event.remaining_reservation_slots}</span> / {event.reservation_capacity} 席
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                      当日券残り: <span style={{ fontWeight: 700, color: event.remaining_walkin_slots > 0 ? 'var(--color-warning)' : 'var(--color-danger)' }}>{event.remaining_walkin_slots}</span> 席
                    </div>
                  </div>
                </div>

                <h3 style={{ fontSize: '1.25rem', marginBottom: '8px', color: 'var(--text-primary)' }}>
                  {event.title}
                </h3>
                
                {event.description && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '16px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {event.description}
                  </p>
                )}

                <div className="event-info-grid">
                  <div className="info-label">開催日時</div>
                  <div className="info-value">{formatDateTime(event.starts_at)}</div>
                  
                  <div className="info-label">予約受付期間</div>
                  <div className="info-value">
                    {event.reservation_starts_at ? formatDateTime(event.reservation_starts_at) : '制限なし'} 〜 <br />
                    {event.reservation_ends_at ? formatDateTime(event.reservation_ends_at) : '制限なし'}
                  </div>

                  <div className="info-label">当日券受付</div>
                  <div className="info-value" style={{ fontSize: '0.82rem' }}>
                    {hasWalkinActive
                      ? <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>受付中</span>
                      : hasWalkinUpcoming
                        ? <span style={{ color: 'var(--text-secondary)' }}>受付前（詳細画面で確認）</span>
                        : (() => {
                            const hasConfig = enabledSlots.some(s => s.is_walkin_enabled && (s.walkin_starts_at || s.walkin_ends_at));
                            if (hasConfig) {
                              return <span style={{ color: 'var(--color-danger)' }}>受付終了</span>;
                            }
                            return <span style={{ color: 'var(--text-muted)' }}>未設定</span>;
                          })()
                    }
                  </div>
                </div>

                <div className="mt-4">
                  {status.active ? (
                    <Link href={`/events/${event.id}`}>
                      <button className="btn btn-primary">
                        {status.buttonText}
                      </button>
                    </Link>
                  ) : (
                    <button className="btn btn-secondary" disabled>
                      {status.buttonText}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
