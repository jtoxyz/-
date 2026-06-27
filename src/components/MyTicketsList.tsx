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
  ticket_code: string;
  public_token: string;
  event_title: string;
  slot_label?: string | null;
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
            // If ticket is not found (perhaps deleted or invalid), clean up cache
            if (!error) removeToken(token);
            return null;
          }

          return data[0] as CachedTicket;
        });

        const fetchedTickets = await Promise.all(ticketFetches);
        const validTickets = fetchedTickets.filter((t: CachedTicket | null): t is CachedTicket => t !== null);
        
        // Filter out cancelled ones if we don't want to display them, or show them?
        // Let's filter out cancelled tickets to keep user dashboard clean, or keep them.
        // It's cleaner to only show 'reserved' or 'used' tickets.
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
        {tickets.map((ticket) => (
          <Link
            key={ticket.public_token}
            href={`/tickets/${ticket.public_token}`}
            style={{ display: 'block' }}
          >
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--card-border)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-primary)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--card-border)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
              }}
            >
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#fff', marginBottom: '2px' }}>
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
              </div>
              <div>
                {ticket.status === 'used' ? (
                  <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>使用済み</span>
                ) : (
                  <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>予約完了</span>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
