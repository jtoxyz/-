'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Clock3, ExternalLink, TicketCheck } from 'lucide-react';
import RichText from '@/components/RichText';
import { supabase } from '@/lib/supabase';
import { formatAccountDate } from '@/lib/studentAccount';

type TicketDetails = {
  reservation_id: string;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  used_at: string | null;
  created_at: string;
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  payment_due_at: string | null;
  event_title: string;
  event_description: string | null;
  ticket_enabled: boolean;
  use_button_enabled: boolean;
  post_reservation_notes: string | null;
  is_ticket_use_suspended: boolean;
  auto_suspend_at: string | null;
  survey_after_reservation_enabled: boolean;
  survey_after_reservation_url: string | null;
  survey_after_reservation_message: string | null;
  survey_after_use_enabled: boolean;
  survey_after_use_url: string | null;
  survey_after_use_message: string | null;
  slot_label: string | null;
  slot_starts_at: string | null;
  slot_ends_at: string | null;
  use_starts_at: string | null;
  use_ends_at: string | null;
};

function safeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function MyTicketPage() {
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingTicket, setUsingTicket] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('reservationId');
    setReservationId(id);
    if (!id) {
      setError('チケットが指定されていません。');
      setLoading(false);
    }
  }, []);

  const loadTicket = async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc('get_my_ticket', {
      p_reservation_id: id,
    });
    if (rpcError || !data || data.length === 0) {
      setError(rpcError?.message || '本人のチケットが見つからないか、使用期限が終了しています。');
      setTicket(null);
    } else {
      setError(null);
      setTicket(data[0] as TicketDetails);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (reservationId) void loadTicket(reservationId);
  }, [reservationId]);

  const useAllowed = useMemo(() => {
    if (!ticket || ticket.status !== 'reserved' || !ticket.ticket_enabled || !ticket.use_button_enabled || ticket.is_ticket_use_suspended) return false;
    const now = Date.now();
    if (ticket.auto_suspend_at && now >= new Date(ticket.auto_suspend_at).getTime()) return false;
    if (ticket.use_starts_at && now < new Date(ticket.use_starts_at).getTime()) return false;
    if (ticket.use_ends_at && now > new Date(ticket.use_ends_at).getTime()) return false;
    if (ticket.payment_status === 'pending' || ticket.payment_status === 'expired') return false;
    return true;
  }, [ticket]);

  const handleUse = async () => {
    if (!ticket || !reservationId || !useAllowed) return;
    if (!confirm('このチケットを使用済みにしますか？この操作は取り消せません。')) return;
    setUsingTicket(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('use_my_ticket', {
      p_reservation_id: reservationId,
    });
    if (rpcError) setError(rpcError.message || 'チケットを使用できませんでした。');
    else await loadTicket(reservationId);
    setUsingTicket(false);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 64 }}><div className="loading-spinner" /></div>;

  if (!ticket) {
    return <div className="glass-card text-center" style={{ padding: 36 }}><div className="error-banner">{error || 'チケットが見つかりません。'}</div><Link href="/#my-tickets"><button className="btn btn-secondary" style={{ marginTop: 18 }}>自分の予約へ戻る</button></Link></div>;
  }

  const paymentText = ticket.payment_status === 'paid'
    ? '支払い済み'
    : ticket.payment_status === 'pending'
      ? `支払い待ち${ticket.payment_due_at ? `（${formatAccountDate(ticket.payment_due_at)}まで）` : ''}`
      : ticket.payment_status === 'expired'
        ? '支払期限切れ'
        : '支払い不要';

  const surveyUrl = ticket.status === 'used'
    ? safeHttpUrl(ticket.survey_after_use_enabled ? ticket.survey_after_use_url : null)
    : safeHttpUrl(ticket.survey_after_reservation_enabled ? ticket.survey_after_reservation_url : null);
  const surveyMessage = ticket.status === 'used'
    ? ticket.survey_after_use_message
    : ticket.survey_after_reservation_message;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}><Link href="/#my-tickets">← 自分の予約へ戻る</Link></div>
      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', textAlign: 'center', fontWeight: 900, background: ticket.status === 'used' ? 'var(--color-warning-bg)' : ticket.status === 'cancelled' ? 'rgba(244,63,94,.12)' : 'var(--color-primary-glow)', color: ticket.status === 'cancelled' ? 'var(--color-danger)' : 'var(--text-primary)' }}>
          {ticket.status === 'used' ? '使用済み' : ticket.status === 'cancelled' ? 'キャンセル済み' : ticket.ticket_type === 'walkin' ? '当日券（未使用）' : '予約券（未使用）'}
        </div>

        <div style={{ padding: 26 }}>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <TicketCheck size={44} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
            <h1 style={{ marginTop: 8, fontSize: '1.55rem' }}>{ticket.event_title}</h1>
            {ticket.slot_label && <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>{ticket.slot_label}　{formatAccountDate(ticket.slot_starts_at)} 〜 {formatAccountDate(ticket.slot_ends_at)}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 18 }}>
            <div className="glass-card" style={{ padding: 14 }}><small style={{ color: 'var(--text-secondary)' }}>氏名</small><div style={{ fontWeight: 800, marginTop: 4 }}>{ticket.student_name}</div></div>
            <div className="glass-card" style={{ padding: 14 }}><small style={{ color: 'var(--text-secondary)' }}>学籍番号</small><div style={{ fontWeight: 800, marginTop: 4 }}>{ticket.student_number}</div></div>
          </div>

          <div style={{ textAlign: 'center', padding: 18, borderRadius: 12, border: '2px solid var(--color-primary)', background: 'var(--color-primary-glow)', marginBottom: 18 }}>
            <small style={{ color: 'var(--text-secondary)' }}>チケットコード</small>
            <div style={{ marginTop: 5, fontSize: '2rem', fontWeight: 900, letterSpacing: '.12em' }}>{ticket.ticket_code}</div>
          </div>

          <div className="glass-card" style={{ padding: 14, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
            <BadgeCheck size={20} aria-hidden="true" />
            <div><small style={{ color: 'var(--text-secondary)' }}>支払い状態</small><div style={{ fontWeight: 800 }}>{paymentText}</div></div>
          </div>

          {ticket.post_reservation_notes && (
            <div className="glass-card" style={{ marginBottom: 18 }}>
              <RichText content={ticket.post_reservation_notes} style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }} />
            </div>
          )}
          {ticket.use_starts_at && <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-secondary)', marginBottom: 14 }}><Clock3 size={17} aria-hidden="true" />使用可能：{formatAccountDate(ticket.use_starts_at)} 〜 {formatAccountDate(ticket.use_ends_at)}</div>}

          {ticket.status === 'reserved' && (
            <button type="button" className="btn btn-primary" onClick={handleUse} disabled={!useAllowed || usingTicket} style={{ width: '100%' }}>
              {usingTicket ? '処理中...' : useAllowed ? 'このチケットを使用する' : '現在は使用できません'}
            </button>
          )}
          {ticket.status === 'used' && ticket.used_at && <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>使用日時：{formatAccountDate(ticket.used_at)}</div>}

          {surveyUrl && (
            <div className="glass-card" style={{ marginTop: 18, borderColor: 'var(--card-border-hover)' }}>
              <p style={{ marginBottom: 12, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{surveyMessage || 'アンケートへのご協力をお願いします。'}</p>
              <a href={surveyUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                アンケートを開く<ExternalLink size={16} aria-hidden="true" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
