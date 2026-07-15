'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getSavedTokens, removeToken } from '@/lib/ticketCache';

interface CachedTicket {
  reservation_id: string;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  public_token: string;
  event_title: string;
  slot_label?: string | null;
  slot_ticket_use_ends_at?: string | null;
}

function formatDeadline(dateStr: string): string {
  const date = new Date(dateStr);
  const datePart = date.toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(date);
  const timePart = date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  });
  return `${datePart}（${weekday}）${timePart}`;
}

function getDeadlineMessage(dateStr: string): { text: string; expired: boolean } {
  const deadline = new Date(dateStr);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();

  if (diffMs <= 0) {
    return { text: `支払期限を過ぎています（${formatDeadline(dateStr)}まで）`, expired: true };
  }

  const remainingDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (remainingDays <= 1) {
    return { text: `支払期限は本日です（${formatDeadline(dateStr)}まで）`, expired: false };
  }

  return {
    text: `支払期限まであと${remainingDays}日（${formatDeadline(dateStr)}まで）`,
    expired: false,
  };
}

export default function MyTicketsList() {
  const [tickets, setTickets] = useState<CachedTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTickets() {
      const tokens = getSavedTokens();
      if (tokens.length === 0) {
        setLoading(false);
        return;
      }

      try {
        const ticketFetches = tokens.map(async (token: string) => {
          const { data, error } = await supabase.rpc('get_ticket', {
            p_public_token: token,
          });

          if (error || !data || data.length === 0) {
            if (!error) removeToken(token);
            return null;
          }

          return data[0] as CachedTicket;
        });

        const fetchedTickets = await Promise.all(ticketFetches);
        const validTickets = fetchedTickets.filter((t: CachedTicket | null): t is CachedTicket => t !== null);
        const activeTickets = validTickets.filter((t: CachedTicket) => t.status !== 'cancelled');
        setTickets(activeTickets);
      } catch (err) {
        console.error('Failed to load cached tickets:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTickets();
  }, []);

  if (loading) {
    return <div className="loading-spinner" style={{ transform: 'scale(0.8)' }}></div>;
  }

  if (tickets.length === 0) {
    return null;
  }

  return (
    <div className="glass-card" style={{ borderColor: 'var(--color-primary-hover)', background: 'rgba(99, 102, 241, 0.05)' }}>
      <h3 style={{ marginBottom: '12px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>🎟️</span> 予約済みのチケット一覧
      </h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        このブラウザで予約したチケットです。タップしてチケット画面を表示できます。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {tickets.map((ticket) => {
          const deadline =
            ticket.status === 'reserved' &&
            ticket.ticket_type === 'reservation' &&
            ticket.slot_ticket_use_ends_at
              ? getDeadlineMessage(ticket.slot_ticket_use_ends_at)
              : null;

          return (
            <Link
              key={ticket.public_token}
              href={`/tickets/${ticket.public_token}`}
              style={{ display: 'block' }}
            >
              <div
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)';
                  e.currentTarget.style.background = 'var(--card-bg)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--card-border)';
                  e.currentTarget.style.background = 'var(--card-bg)';
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                    {ticket.event_title}
                  </div>
                  {ticket.slot_label && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                      📅 {ticket.slot_label}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    氏名: {ticket.student_name} / 学籍番号: {ticket.student_number}
                  </div>
                  {deadline && (
                    <div
                      style={{
                        marginTop: '8px',
                        fontSize: '0.76rem',
                        lineHeight: 1.5,
                        fontWeight: 700,
                        color: deadline.expired ? 'var(--color-danger)' : 'var(--color-warning)',
                      }}
                    >
                      💴 {deadline.text}
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {ticket.status === 'used' ? (
                    <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>使用済み</span>
                  ) : ticket.ticket_type === 'walkin' ? (
                    <span className="badge" style={{ fontSize: '0.7rem', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderColor: 'var(--color-warning-border)' }}>当日券</span>
                  ) : (
                    <span className="badge" style={{ fontSize: '0.7rem', backgroundColor: 'var(--color-primary-glow)', color: 'var(--color-primary)', borderColor: 'var(--card-border-hover)' }}>予約券</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
