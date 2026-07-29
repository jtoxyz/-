export const runtime = 'edge';
export const revalidate = 0;

import Link from 'next/link';
import { ArrowRight, CalendarDays, TriangleAlert } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import MyTicketsList from '@/components/MyTicketsList';

type PublicEventSlot = {
  id: string;
  label: string;
  is_enabled: boolean;
  reservation_status: string;
  walkin_status: string;
};

type PublicEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  slots: PublicEventSlot[];
};

function formatDateTime(value: string | null): string {
  if (!value) return '未設定';
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

function eventStatus(event: PublicEvent) {
  const slots = (event.slots || []).filter((slot) => slot.is_enabled);
  if (slots.some((slot) => ['available', 'low_remaining'].includes(slot.reservation_status))) {
    return { label: '予約受付中', button: '予約画面へ進む', badge: 'badge-success', active: true };
  }
  if (slots.some((slot) => ['walkin_available', 'walkin_low_remaining'].includes(slot.walkin_status))) {
    return { label: '当日券受付中', button: '当日券を取得する', badge: 'badge-warning', active: true };
  }
  if (slots.some((slot) => slot.reservation_status === 'before_open' || slot.walkin_status === 'walkin_upcoming')) {
    return { label: '受付前', button: '詳細を見る', badge: 'badge-secondary', active: true };
  }
  if (slots.some((slot) => slot.reservation_status === 'full' || slot.walkin_status === 'walkin_full')) {
    return { label: '満席', button: '満席', badge: 'badge-danger', active: false };
  }
  return { label: '受付終了', button: '受付終了', badge: 'badge-danger', active: false };
}

function slotSummary(event: PublicEvent): string {
  const slots = (event.slots || []).filter((slot) => slot.is_enabled);
  const reservationOpen = slots.filter((slot) => ['available', 'low_remaining'].includes(slot.reservation_status)).length;
  const walkinOpen = slots.filter((slot) => ['walkin_available', 'walkin_low_remaining'].includes(slot.walkin_status)).length;
  if (reservationOpen > 0 && walkinOpen > 0) return `予約受付 ${reservationOpen}枠・当日券 ${walkinOpen}枠`;
  if (reservationOpen > 0) return `予約受付中 ${reservationOpen}枠`;
  if (walkinOpen > 0) return `当日券受付中 ${walkinOpen}枠`;
  return slots.length > 0 ? `${slots.length}枠` : '開催枠準備中';
}

export default async function Home() {
  const { data, error } = await supabase.rpc('get_public_events');
  const events = (data as PublicEvent[] | null) || [];

  return (
    <div>
      <div className="text-center" style={{ marginBottom: 30 }}>
        <h1 className="page-title">委員会企画予約</h1>
        <p className="page-subtitle">大学Googleアカウントで予約・当日券・電子チケットをまとめて管理できます。</p>
      </div>

      <MyTicketsList />

      <h2 style={{ fontSize: '1.4rem', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <CalendarDays size={24} aria-hidden="true" />公開中の企画一覧
      </h2>

      {error && (
        <div className="error-banner">
          <TriangleAlert size={20} aria-hidden="true" />企画一覧の取得に失敗しました。時間をおいて再度お試しください。
        </div>
      )}

      {!error && events.length === 0 && (
        <div className="glass-card text-center" style={{ padding: '40px 20px', color: 'var(--text-secondary)' }}>
          <p style={{ fontSize: '1.15rem', marginBottom: 7 }}>現在公開中の企画はありません</p>
          <p style={{ fontSize: '0.875rem' }}>企画が追加されるまでお待ちください。</p>
        </div>
      )}

      {events.length > 0 && (
        <div className="events-grid">
          {events.map((event) => {
            const status = eventStatus(event);
            return (
              <article key={event.id} className="glass-card interactive">
                <div className="flex-between" style={{ marginBottom: 12, alignItems: 'flex-start', gap: 12 }}>
                  <span className={`badge ${status.badge}`}>{status.label}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', textAlign: 'right' }}>{slotSummary(event)}</span>
                </div>

                <h3 style={{ fontSize: '1.25rem', marginBottom: 8 }}>{event.title}</h3>
                {event.description && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                    {event.description}
                  </p>
                )}

                <div className="event-info-grid">
                  <div className="info-label">開催日時</div>
                  <div className="info-value">{formatDateTime(event.starts_at)} 〜<br />{formatDateTime(event.ends_at)}</div>
                  <div className="info-label">予約受付期間</div>
                  <div className="info-value">{formatDateTime(event.reservation_starts_at)} 〜<br />{formatDateTime(event.reservation_ends_at)}</div>
                </div>

                <div className="mt-4">
                  {status.active ? (
                    <Link href={`/reserve?id=${encodeURIComponent(event.id)}`}>
                      <button className="btn btn-primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        {status.button}<ArrowRight size={17} aria-hidden="true" />
                      </button>
                    </Link>
                  ) : (
                    <button className="btn btn-secondary" disabled>{status.button}</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
