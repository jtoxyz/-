import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import MyTicketsList from '@/components/MyTicketsList';

// Opt out of static caching so reservation numbers are always real-time
export const revalidate = 0;

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
    if (!event.reservation_enabled) {
      return { label: '受付停止中', active: false, badge: 'badge-danger' };
    }
    if (event.reservation_starts_at && new Date(event.reservation_starts_at) > now) {
      return { label: '受付開始前', active: false, badge: 'badge-warning' };
    }
    if (event.reservation_ends_at && new Date(event.reservation_ends_at) < now) {
      return { label: '受付終了', active: false, badge: 'badge-danger' };
    }
    if (event.remaining_slots <= 0) {
      return { label: '定員到達', active: false, badge: 'badge-danger' };
    }
    return { label: '予約受付中', active: true, badge: 'badge-success' };
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
            const isLowSlots = event.remaining_slots > 0 && event.remaining_slots <= 5;
            
            return (
              <div key={event.id} className="glass-card interactive">
                <div className="flex-between" style={{ marginBottom: '12px' }}>
                  <span className={`badge ${status.badge}`}>{status.label}</span>
                  <div className={`remaining-count ${event.remaining_slots === 0 ? 'zero' : isLowSlots ? 'low' : ''}`}>
                    残 {event.remaining_slots} 席
                  </div>
                </div>

                <h3 style={{ fontSize: '1.25rem', marginBottom: '8px', color: '#ffffff' }}>
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
                  
                  <div className="info-label">受付期間</div>
                  <div className="info-value">
                    {event.reservation_starts_at ? formatDateTime(event.reservation_starts_at) : '制限なし'} 〜 <br />
                    {event.reservation_ends_at ? formatDateTime(event.reservation_ends_at) : '制限なし'}
                  </div>
                </div>

                <div className="mt-4">
                  {status.active ? (
                    <Link href={`/events/${event.id}`}>
                      <button className="btn btn-primary">
                        予約フォームへ進む ➔
                      </button>
                    </Link>
                  ) : (
                    <button className="btn btn-secondary" disabled>
                      予約できません
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
