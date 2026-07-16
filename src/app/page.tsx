import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import MyTicketsList from '@/components/MyTicketsList';

// Opt out of static caching so reservation numbers are always real-time
export const revalidate = 0;

interface PublicEventSlot {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  is_enabled: boolean;
  reservation_status: string;
  walkin_status: string;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  ticket_use_starts_at: string | null;
  ticket_use_ends_at: string | null;
  walkin_starts_at: string | null;
  walkin_ends_at: string | null;
  is_reservation_enabled: boolean;
  is_ticket_use_enabled: boolean;
  is_walkin_enabled: boolean;
}

interface PublicEvent {
  id: string;
  title: string;
  description: string;
  starts_at: string | null;
  ends_at: string | null;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  reservation_enabled: boolean;
  ticket_enabled: boolean;
  use_button_enabled: boolean;
  use_starts_at: string | null;
  use_ends_at: string | null;
  allowed_email_domains: string[];
  slot_selection_mode: 'single' | 'multiple';
  created_at: string;
  has_walkin_active: boolean;
  has_walkin_upcoming: boolean;
  slots: PublicEventSlot[];
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '制限なし';
  const date = new Date(dateStr);
  const dateTimeStr = date.toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(date);
  return `${dateTimeStr} (${weekday})`;
}

export default async function Home() {
  // Fetch public events from Supabase secure RPC
  const { data: events, error } = await supabase.rpc('get_public_events');

  const now = new Date();

  const getEventStatus = (event: PublicEvent) => {
    const enabledSlots = event.slots?.filter(s => s.is_enabled) || [];

    if (enabledSlots.length === 0) {
      return { label: '準備中', buttonText: '準備中', active: false, badge: 'badge-secondary' };
    }

    if (enabledSlots.every(s => s.reservation_status === 'suspended' && s.walkin_status === 'suspended')) {
      return { label: '停止中', buttonText: '停止中', active: false, badge: 'badge-danger' };
    }

    // 1. 予約受付中
    const hasReservationActive = enabledSlots.some(s => s.reservation_status === 'available' || s.reservation_status === 'low_remaining');
    if (hasReservationActive) {
      return { label: '予約受付中', buttonText: '予約フォームへ進む ➔', active: true, badge: 'badge-success' };
    }

    // 2. 予約受付前
    const hasReservationUpcoming = enabledSlots.some(s => s.reservation_status === 'before_open');
    if (hasReservationUpcoming) {
      return { label: '予約受付前', buttonText: '詳細を見る ➔', active: true, badge: 'badge-secondary' };
    }

    // 3. 当日券受付中
    const hasWalkinActive = enabledSlots.some(s => s.walkin_status === 'walkin_available' || s.walkin_status === 'walkin_low_remaining');
    if (hasWalkinActive) {
      return { label: '当日券受付中', buttonText: '当日券を取得する ➔', active: true, badge: 'badge-warning' };
    }

    // 4. 当日券受付前
    const hasWalkinUpcoming = enabledSlots.some(s => s.walkin_status === 'walkin_upcoming');
    if (hasWalkinUpcoming) {
      return { label: '当日券受付前', buttonText: '詳細を見る ➔', active: true, badge: 'badge-warning' };
    }

    // 5. 満席
    const isAllFull = enabledSlots.every(s => 
      (!s.is_reservation_enabled || s.reservation_status === 'full' || s.reservation_status === 'closed') &&
      (!s.is_walkin_enabled || s.walkin_status === 'walkin_full' || s.walkin_status === 'walkin_closed')
    ) && enabledSlots.some(s => s.reservation_status === 'full' || s.walkin_status === 'walkin_full');
    
    if (isAllFull) {
      return { label: '満席', buttonText: '満席', active: false, badge: 'badge-danger' };
    }

    // 6. 受付終了
    return { label: '受付終了', buttonText: '受付終了', active: false, badge: 'badge-danger' };
  };

  const getStatusLabel = (status: string) => {
    switch(status) {
      case 'available':
      case 'walkin_available':
        return { text: '余裕あり', color: 'var(--color-success)' };
      case 'low_remaining':
      case 'walkin_low_remaining':
        return { text: '残りわずか', color: 'var(--color-warning)' };
      case 'full':
      case 'walkin_full':
        return { text: '満席', color: 'var(--color-danger)' };
      case 'before_open':
      case 'walkin_upcoming':
        return { text: '受付前', color: 'var(--text-secondary)' };
      case 'suspended':
        return { text: '停止中', color: 'var(--color-danger)' };
      case 'closed':
      case 'walkin_closed':
      default:
        return { text: '受付終了', color: 'var(--text-muted)' };
    }
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

            const bestResStatus = enabledSlots.reduce((best, s) => {
              const order = { 'available': 1, 'low_remaining': 2, 'full': 3, 'before_open': 4, 'closed': 5, 'suspended': 6 };
              const currentOrder = order[best as keyof typeof order] || 99;
              const newOrder = order[s.reservation_status as keyof typeof order] || 99;
              return newOrder < currentOrder ? s.reservation_status : best;
            }, 'closed');

            const bestWalkinStatus = enabledSlots.reduce((best, s) => {
              const order = { 'walkin_available': 1, 'walkin_low_remaining': 2, 'walkin_full': 3, 'walkin_upcoming': 4, 'walkin_closed': 5, 'suspended': 6 };
              const currentOrder = order[best as keyof typeof order] || 99;
              const newOrder = order[s.walkin_status as keyof typeof order] || 99;
              return newOrder < currentOrder ? s.walkin_status : best;
            }, 'walkin_closed');

            const resDisplay = getStatusLabel(bestResStatus);
            const walkinDisplay = getStatusLabel(bestWalkinStatus);

            return (
              <div key={event.id} className="glass-card interactive">
                <div className="flex-between" style={{ marginBottom: '12px', alignItems: 'flex-start' }}>
                  <span className={`badge ${status.badge}`}>{status.label}</span>
                  <div style={{ textAlign: 'right', fontSize: '0.78rem', lineHeight: '1.4' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>
                      予約受付: <span style={{ fontWeight: 700, color: resDisplay.color }}>{resDisplay.text}</span>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                      当日券受付: <span style={{ fontWeight: 700, color: walkinDisplay.color }}>{walkinDisplay.text}</span>
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
                    {bestWalkinStatus === 'walkin_available' || bestWalkinStatus === 'walkin_low_remaining'
                      ? <span style={{ color: 'var(--color-warning)', fontWeight: 600 }}>受付中</span>
                      : bestWalkinStatus === 'walkin_upcoming'
                        ? <span style={{ color: 'var(--text-secondary)' }}>受付前（詳細画面で確認）</span>
                        : (() => {
                            const hasConfig = enabledSlots.some(s => s.is_walkin_enabled);
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
