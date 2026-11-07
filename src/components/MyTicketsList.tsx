'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CircleX, Clock3, Tickets } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { type PaymentVisitSlot, fetchMyVisitSlots, formatVisitSlot, visitSlotPlace } from '@/lib/paymentVisit';

type MyTicket = {
  reservation_id: string;
  event_title: string;
  slot_label: string | null;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  payment_due_at: string | null;
  slot_starts_at: string | null;
};

type CancelledTicket = {
  reservation_id: string;
  event_title: string;
  slot_label: string | null;
  slot_starts_at: string | null;
  ticket_type: 'reservation' | 'walkin';
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  cancelled_at: string | null;
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

function paymentLabel(ticket: MyTicket, visit?: PaymentVisitSlot): string | null {
  if (ticket.payment_status === 'paid') return '支払い済み';
  if (ticket.payment_status === 'expired') return '支払期限切れ';
  if (ticket.payment_status === 'pending') {
    if (visit) return `${visitSlotPlace(visit)}で支払い：${formatVisitSlot(visit)}`;
    return ticket.payment_due_at
      ? `支払待ち：${formatDateTime(ticket.payment_due_at)}まで`
      : '支払い待ち';
  }
  return null;
}

export default function MyTicketsList() {
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [visits, setVisits] = useState<Record<string, PaymentVisitSlot>>({});
  const [cancelled, setCancelled] = useState<CancelledTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadTickets = async () => {
      const [{ data, error: rpcError }, cancelledResult] = await Promise.all([
        supabase.rpc('get_my_tickets'),
        supabase.rpc('get_my_cancelled_tickets'),
      ]);
      if (!active) return;
      setCancelled(cancelledResult.error ? [] : ((cancelledResult.data as CancelledTicket[] | null) || []));

      if (rpcError) {
        setError(rpcError.message || '予約一覧を取得できませんでした。');
        setTickets([]);
      } else {
        const loaded = (data as MyTicket[] | null) || [];
        setError(null);
        setTickets(loaded);
        const pendingIds = loaded.filter((t) => t.payment_status === 'pending').map((t) => t.reservation_id);
        const loadedVisits = await fetchMyVisitSlots(pendingIds);
        if (!active) return;
        setVisits(loadedVisits);
      }
      setLoading(false);
    };

    void loadTickets();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') void loadTickets();
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return (
    <section id="my-tickets" className="glass-card" style={{ marginBottom: 28, borderColor: 'var(--card-border-hover)' }}>
      <h2 style={{ marginBottom: 8, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tickets size={23} aria-hidden="true" />
        <span>自分の予約</span>
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: 16 }}>
        このGoogleアカウントに紐づく予約券・当日券です。別の端末からログインしても表示されます。
      </p>

      {loading && <div style={{ textAlign: 'center', padding: 18 }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && tickets.length === 0 && (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          現在、有効な予約はありません。
        </div>
      )}

      {!loading && tickets.length > 0 && (
        <div style={{ display: 'grid', gap: 10 }}>
          {tickets.map((ticket) => {
            const payment = paymentLabel(ticket, visits[ticket.reservation_id]);
            return (
              <Link key={ticket.reservation_id} href={`/my-tickets?reservationId=${encodeURIComponent(ticket.reservation_id)}`} style={{ display: 'block' }}>
                <div className="glass-card interactive" style={{ padding: '13px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{ticket.event_title}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {ticket.slot_label && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CalendarDays size={14} aria-hidden="true" />{ticket.slot_label}
                        </span>
                      )}
                      {ticket.slot_starts_at && <span>{formatDateTime(ticket.slot_starts_at)}</span>}
                    </div>
                    {payment && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: '0.78rem', fontWeight: 700, color: ticket.payment_status === 'expired' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                        <Clock3 size={14} aria-hidden="true" />{payment}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0, textAlign: 'right' }}>
                    <span className={`badge ${ticket.status === 'used' ? 'badge-secondary' : ticket.ticket_type === 'walkin' ? 'badge-warning' : 'badge-success'}`}>
                      {ticket.status === 'used' ? '使用済み' : ticket.ticket_type === 'walkin' ? '当日券' : '予約券'}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && cancelled.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            キャンセルされた予約（直近30日・{cancelled.length}件）
          </summary>
          <ul style={{ listStyle: 'none', display: 'grid', gap: 8, marginTop: 10 }}>
            {cancelled.map((ticket) => (
              <li key={ticket.reservation_id} className="glass-card" style={{ padding: '11px 14px', margin: 0, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <CircleX size={18} aria-hidden="true" style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: 2 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{ticket.event_title}{ticket.slot_label ? `（${ticket.slot_label}）` : ''}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                    {ticket.payment_status === 'expired'
                      ? '支払期限までに支払いが確認できなかったため、自動でキャンセルされました。'
                      : '委員会がキャンセルしました。心当たりがない場合は委員会にお問い合わせください。'}
                    {ticket.cancelled_at && <span>（{formatDateTime(ticket.cancelled_at)}）</span>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
