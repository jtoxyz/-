'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CircleCheckBig, CircleX, Clock3, Ticket, Tickets } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatTicketOption, formatYen } from '@/lib/ticketOption';
import { type PaymentVisitSlot, fetchMyVisitSlots, formatVisitSlot, visitSlotPlace } from '@/lib/paymentVisit';
import { NOSHOW_BLACKLIST_COUNT } from '@/lib/accessStatus';
import PaymentQrScanButton from '@/components/payment/PaymentQrScanButton';
import ReceptionQrCard from '@/components/payment/ReceptionQrCard';
import { getPaymentConfirmModes } from '@/lib/staffPaymentRpc';
import type { PaymentConfirmMode } from '@/lib/staffPaymentScan';
import PcBlockedTicket from '@/components/PcBlockedTicket';
import SmartphoneOnlyNotice from '@/components/SmartphoneOnlyNotice';
import { useIsPcDevice } from '@/hooks/useIsPcDevice';
import { fetchIsStaffOrAdmin } from '@/lib/staffStatus';

type MyTicket = {
  reservation_id: string;
  event_id: string;
  public_token: string;
  event_title: string;
  slot_label: string | null;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  payment_due_at: string | null;
  slot_starts_at: string | null;
  ticket_option_label?: string | null;
  ticket_option_price_yen?: number | null;
  /** 受付・受取をスマホだけに限る企画か（DB反映前は返らないので任意） */
  smartphone_only_ticket?: boolean | null;
};

type CancelledTicket = {
  reservation_id: string;
  event_title: string;
  slot_label: string | null;
  slot_starts_at: string | null;
  ticket_type: 'reservation' | 'walkin';
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  cancelled_at: string | null;
  ticket_option_label?: string | null;
  ticket_option_price_yen?: number | null;
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
    if (ticket.ticket_option_price_yen != null) {
      const amount = formatYen(ticket.ticket_option_price_yen);
      if (visit) return `${visitSlotPlace(visit)}で${amount}を支払い：${formatVisitSlot(visit)}`;
      return ticket.payment_due_at
        ? `${amount}を支払い：${formatDateTime(ticket.payment_due_at)}まで`
        : `${amount}を支払い`;
    }
    if (visit) return `${visitSlotPlace(visit)}で支払い：${formatVisitSlot(visit)}`;
    return ticket.payment_due_at
      ? `支払待ち：${formatDateTime(ticket.payment_due_at)}まで`
      : '支払い待ち';
  }
  return null;
}

/**
 * 券種を一覧でも大きく見せる。受付は予約画面で券種を見て金額を判断するため。
 * 未払いなら払う金額を大きく、支払い済みなら「支払い済み」をはっきり出して、二重に受け取らないようにする。
 */
function TicketOptionBadge({ ticket }: { ticket: MyTicket }) {
  const price = ticket.ticket_option_price_yen;
  const pending = ticket.payment_status === 'pending';
  const paid = ticket.payment_status === 'paid';
  const tone = pending
    ? { bg: 'var(--color-warning-bg)', border: 'var(--color-warning-border)' }
    : paid
      ? { bg: 'var(--color-success-bg)', border: 'var(--color-success-border)' }
      : { bg: 'transparent', border: 'var(--card-border)' };
  return (
    <div
      style={{
        margin: '4px 0 8px', padding: '8px 12px', borderRadius: 10,
        background: tone.bg, border: `1px solid ${tone.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
        <Ticket size={14} aria-hidden="true" />券種
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '2px 10px', marginTop: 2 }}>
        <span style={{ fontSize: '1.2rem', fontWeight: 900, lineHeight: 1.35 }}>{ticket.ticket_option_label}</span>
        {pending && price != null && (
          <span style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--color-warning)' }}>{formatYen(price)}</span>
        )}
        {paid && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.95rem', fontWeight: 800, color: 'var(--color-success)' }}>
            <CircleCheckBig size={16} aria-hidden="true" />支払い済み
          </span>
        )}
        {!pending && !paid && price != null && (
          <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{formatYen(price)}</span>
        )}
      </div>
    </div>
  );
}

export default function MyTicketsList() {
  const [tickets, setTickets] = useState<MyTicket[]>([]);
  const [visits, setVisits] = useState<Record<string, PaymentVisitSlot>>({});
  const [modes, setModes] = useState<Record<string, PaymentConfirmMode>>({});
  const [cancelled, setCancelled] = useState<CancelledTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStaffOrAdmin, setIsStaffOrAdmin] = useState(false);
  const isPc = useIsPcDevice();

  useEffect(() => {
    let active = true;

    const loadTickets = async () => {
      const [{ data, error: rpcError }, cancelledResult, staffOrAdmin] = await Promise.all([
        supabase.rpc('get_my_tickets'),
        supabase.rpc('get_my_cancelled_tickets'),
        fetchIsStaffOrAdmin(supabase),
      ]);
      if (!active) return;
      setIsStaffOrAdmin(staffOrAdmin);
      setCancelled(cancelledResult.error ? [] : ((cancelledResult.data as CancelledTicket[] | null) || []));

      if (rpcError) {
        setError(rpcError.message || '予約一覧を取得できませんでした。');
        setTickets([]);
      } else {
        const loaded = (data as MyTicket[] | null) || [];
        setError(null);
        setTickets(loaded);
        const pendingIds = loaded.filter((t) => t.payment_status === 'pending').map((t) => t.reservation_id);
        const pendingEventIds = [...new Set(loaded.filter((t) => t.payment_status === 'pending').map((t) => t.event_id))];
        const [loadedVisits, loadedModes] = await Promise.all([
          fetchMyVisitSlots(pendingIds),
          getPaymentConfirmModes(supabase, pendingEventIds),
        ]);
        if (!active) return;
        setVisits(loadedVisits);
        setModes(loadedModes);
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

  const isStaffMode = (t: MyTicket) => modes[t.event_id] === 'staff';
  const unpaid = tickets.filter((t) => t.status === 'reserved' && t.payment_status === 'pending');
  // 受付の係が確認する企画ごとに、未払いの予約をまとめて1枚のQRにする
  // スマホ限定の企画では、一般の学生がPCで開いたときに受付で見せるQRを出さない（スタッフ・管理者は除く）
  const pcBlocked = (t: MyTicket) => t.smartphone_only_ticket === true && isPc && !isStaffOrAdmin;
  const hasSmartphoneOnly = tickets.some((t) => t.smartphone_only_ticket === true);
  const receptionEventIds = [...new Set(unpaid.filter(isStaffMode).map((t) => t.event_id))];
  const hiddenReceptionCount = receptionEventIds.filter((eventId) => unpaid.some((t) => t.event_id === eventId && pcBlocked(t))).length;
  const receptionCards = receptionEventIds.filter((eventId) => !unpaid.some((t) => t.event_id === eventId && pcBlocked(t))).map((eventId) => {
    const rows = unpaid.filter((t) => t.event_id === eventId);
    const priced = rows.filter((t) => t.ticket_option_price_yen != null);
    return {
      eventId,
      eventTitle: rows[0].event_title,
      publicToken: rows[0].public_token,
      totalYen: priced.length > 0 ? priced.reduce((sum, t) => sum + (t.ticket_option_price_yen ?? 0), 0) : null,
    };
  });

  return (
    <section id="my-tickets" className="glass-card" style={{ marginBottom: 28, borderColor: 'var(--card-border-hover)' }}>
      <h2 style={{ marginBottom: 8, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tickets size={23} aria-hidden="true" />
        <span>自分の予約</span>
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', marginBottom: 16 }}>
        このGoogleアカウントに紐づく予約券・当日券です。別の端末からログインしても表示されます。
      </p>

      {!loading && hasSmartphoneOnly && <SmartphoneOnlyNotice style={{ marginBottom: 14 }} />}

      {loading && <div style={{ textAlign: 'center', padding: 18 }}><div className="loading-spinner" style={{ margin: '0 auto' }} /></div>}
      {error && <div className="error-banner">{error}</div>}

      {!loading && !error && tickets.length === 0 && (
        <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          現在、有効な予約はありません。
        </div>
      )}

      {!loading && hiddenReceptionCount > 0 && (
        <div style={{ marginBottom: 12 }}><PcBlockedTicket what="受付で見せるQR" /></div>
      )}

      {!loading && receptionCards.length > 0 && (
        <div style={{ display: 'grid', gap: 12, marginBottom: 12 }}>
          {receptionCards.map((card) => (
            <ReceptionQrCard key={card.eventId} eventTitle={card.eventTitle} publicToken={card.publicToken} totalYen={card.totalYen} />
          ))}
        </div>
      )}

      {!loading && unpaid.some((t) => !isStaffMode(t)) && (
        <div style={{ marginBottom: 12 }}>
          <PaymentQrScanButton />
          <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            受付で支払ったら、このボタンで受付のQRコードを読み取ってください（ログインし直す必要はありません）。
          </div>
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
                    {ticket.ticket_option_label && <TicketOptionBadge ticket={ticket} />}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      {ticket.slot_label && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CalendarDays size={14} aria-hidden="true" />{ticket.slot_label}
                        </span>
                      )}
                      {ticket.slot_starts_at && <span>{formatDateTime(ticket.slot_starts_at)}</span>}
                    </div>
                    {payment && !(ticket.payment_status === 'paid' && ticket.ticket_option_label) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 7, fontSize: '0.78rem', fontWeight: 700, color: ticket.payment_status === 'expired' ? 'var(--color-danger)' : 'var(--color-warning)' }}>
                        <Clock3 size={14} aria-hidden="true" />{payment}
                      </div>
                    )}
                    {ticket.payment_status === 'pending' && (
                      <div style={{ marginTop: 4, fontSize: '0.75rem', color: 'var(--color-warning)', lineHeight: 1.6 }}>
                        時間内に来ないと自動キャンセルされ、来なかった回数に数えられます（{NOSHOW_BLACKLIST_COUNT}回で利用停止）。
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
                  {ticket.ticket_option_label && (
                    <div style={{ fontSize: '0.8rem', marginTop: 2 }}>券種：{formatTicketOption(ticket.ticket_option_label, ticket.ticket_option_price_yen)}</div>
                  )}
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
