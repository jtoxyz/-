'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CircleCheckBig, Clock3, ExternalLink } from 'lucide-react';
import RichText from '@/components/RichText';
import { supabase } from '@/lib/supabase';
import { formatAccountDate } from '@/lib/studentAccount';
import { type PaymentVisitSlot, fetchMyVisitSlots, formatVisitSlot, visitSlotPlace } from '@/lib/paymentVisit';
import { useQueryParam } from '@/hooks/useQueryParam';
import { useLoadEffect } from '@/hooks/useLoadEffect';

type TicketDetails = {
  reservation_id: string;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  used_at: string | null;
  created_at: string;
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  payment_due_at: string | null;
  event_title: string;
  event_description: string | null;
  ticket_enabled: boolean;
  use_button_enabled: boolean;
  ticket_reveal_minutes: number;
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

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}時間${minutes}分`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 使用日時が今からどれくらい前か（「いつ使ったか」をひと目で分かるように） */
function formatUsedAgo(usedAt: string, now: number): string | null {
  const diffMs = now - new Date(usedAt).getTime();
  if (diffMs < 0) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.floor(hours / 24)}日前`;
}

/** チケットを今使えない理由（使えるときは null） */
function ticketBlockReason(ticket: TicketDetails | null, now: number): string | null {
  if (!ticket || ticket.status !== 'reserved') return null;
  if (!ticket.ticket_enabled || !ticket.use_button_enabled) return 'この企画では、まだチケットの使用が始まっていません。';
  if (ticket.is_ticket_use_suspended) return '現在、チケットの使用を一時停止しています。';
  if (ticket.auto_suspend_at && now >= new Date(ticket.auto_suspend_at).getTime()) return '現在、チケットの使用を停止しています。';
  if (ticket.payment_status === 'pending') return '支払いが確認されると使えるようになります。';
  if (ticket.payment_status === 'expired') return '支払期限が過ぎたため使用できません。';
  if (ticket.use_starts_at && now < new Date(ticket.use_starts_at).getTime()) {
    return `${formatAccountDate(ticket.use_starts_at)}から使えます（あと${formatRemaining(new Date(ticket.use_starts_at).getTime() - now)}）。`;
  }
  if (ticket.use_ends_at && now > new Date(ticket.use_ends_at).getTime()) return '使用できる時間は終了しました。';
  return null;
}

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
  const reservationId = useQueryParam('reservationId');
  const [ticket, setTicket] = useState<TicketDetails | null>(null);
  const [visitSlot, setVisitSlot] = useState<PaymentVisitSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingTicket, setUsingTicket] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const loadTicket = useCallback(async (id: string) => {
    const { data, error: rpcError } = await supabase.rpc('get_my_ticket', {
      p_reservation_id: id,
    });
    if (rpcError || !data || data.length === 0) {
      setError(rpcError?.message || '本人のチケットが見つからないか、使用期限が終了しています。');
      setTicket(null);
    } else {
      setError(null);
      setTicket(data[0] as TicketDetails);
      const visits = await fetchMyVisitSlots([id]);
      setVisitSlot(visits[id] ?? null);
    }
    setLoading(false);
  }, []);

  useLoadEffect(() => {
    if (reservationId) return loadTicket(reservationId);
  }, [reservationId, loadTicket]);

  // 使用開始時刻を過ぎたらボタンが押せるよう、未使用の間も時刻を進める（再読み込みしなくてよい）
  useEffect(() => {
    if (ticket?.status !== 'reserved') return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticket?.status]);

  // 支払い待ちの間は、支払いが確認されたかを30秒ごとに確認する
  useEffect(() => {
    if (!reservationId || ticket?.status !== 'reserved' || ticket.payment_status !== 'pending') return;
    const id = setInterval(() => void loadTicket(reservationId), 30_000);
    return () => clearInterval(id);
  }, [reservationId, ticket?.status, ticket?.payment_status, loadTicket]);

  const blockReason = ticketBlockReason(ticket, nowTick);
  const useAllowed = Boolean(ticket && ticket.status === 'reserved' && !blockReason);

  const ticketReveal = useMemo(() => {
    if (!ticket || ticket.status !== 'used' || !ticket.used_at) return null;
    const expiresAtMs = new Date(ticket.used_at).getTime() + ticket.ticket_reveal_minutes * 60 * 1000;
    const remainingMs = expiresAtMs - nowTick;
    return remainingMs > 0 ? { visible: true as const, remainingMs } : { visible: false as const, remainingMs: 0 };
  }, [ticket, nowTick]);

  useEffect(() => {
    if (!ticketReveal?.visible) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticketReveal?.visible]);

  const handleUse = async () => {
    if (!ticket || !reservationId || !useAllowed) return;
    if (!confirm(`このチケットを使用済みにします。受付のスタッフの前で押してください。使用済みの確認画面は${ticket.ticket_reveal_minutes}分間だけ表示されます。この操作は取り消せません。よろしいですか？`)) return;
    setUsingTicket(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('use_my_ticket', {
      p_reservation_id: reservationId,
    });
    if (rpcError) setError(rpcError.message || 'チケットを使用できませんでした。');
    else await loadTicket(reservationId);
    setUsingTicket(false);
  };

  if (reservationId === null) {
    return <div className="glass-card text-center" style={{ padding: 36 }}><div className="error-banner">チケットが指定されていません。</div><Link href="/#my-tickets" className="btn btn-secondary" style={{ marginTop: 18 }}>自分の予約へ戻る</Link></div>;
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 64 }}><div className="loading-spinner" /></div>;

  if (!ticket) {
    return <div className="glass-card text-center" style={{ padding: 36 }}><div className="error-banner">{error || 'チケットが見つかりません。'}</div><Link href="/#my-tickets" className="btn btn-secondary" style={{ marginTop: 18 }}>自分の予約へ戻る</Link></div>;
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

  const usedAgo = ticket.used_at ? formatUsedAgo(ticket.used_at, nowTick) : null;
  const kindLabel = ticket.ticket_type === 'walkin' ? '当日券' : '予約券';
  const statusLabel = ticket.status === 'used' ? '使用済み' : ticket.status === 'cancelled' ? 'キャンセル済み' : '未使用';

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}><Link href="/#my-tickets">← 自分の予約へ戻る</Link></div>
      {error && <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>{error}</div>}

      {/* 紙のチケットの形：上が企画（券面）、切り取り線の下が本人情報と使用状態（半券） */}
      <article className={`ticket ticket--${ticket.status}`} aria-label={`${ticket.event_title}の${kindLabel}（${statusLabel}）`}>
        <div className="ticket-head">
          <div className="ticket-kind">
            <span>{kindLabel}</span>
            {ticket.status === 'reserved' && <span className="ticket-status-chip">{statusLabel}</span>}
          </div>
          <h1 className="ticket-title">{ticket.event_title}</h1>
          {ticket.slot_label && <div className="ticket-when">{ticket.slot_label}</div>}
          {ticket.slot_starts_at && <div className="ticket-when">{formatAccountDate(ticket.slot_starts_at)} 〜 {formatAccountDate(ticket.slot_ends_at)}</div>}
          {ticket.status === 'used' && <div className="ticket-stamp" aria-hidden="true">使用済</div>}
          {ticket.status === 'cancelled' && <div className="ticket-stamp" aria-hidden="true">無効</div>}
        </div>

        <div className="ticket-perf" aria-hidden="true" />

        <div className="ticket-stub">
          <dl className="ticket-fields">
            <div><dt>氏名</dt><dd>{ticket.student_name}</dd></div>
            <div><dt>学籍番号</dt><dd>{ticket.student_number}</dd></div>
          </dl>

          {ticket.status === 'used' && ticketReveal?.visible && (
            <div className="ticket-used-live" style={{ marginTop: 16, textAlign: 'center', padding: '16px 14px', borderRadius: 12, border: '3px solid var(--color-success)', background: 'var(--color-success-bg)' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '1.6rem', fontWeight: 900, letterSpacing: '.08em' }}>
                <CircleCheckBig size={32} style={{ color: 'var(--color-success)' }} aria-hidden="true" />使用しました
              </div>
              {ticket.used_at && (
                <div style={{ marginTop: 6, fontWeight: 700 }}>
                  {formatAccountDate(ticket.used_at)} に使用{usedAgo && <span style={{ color: 'var(--text-secondary)' }}>（{usedAgo}）</span>}
                </div>
              )}
              <div style={{ marginTop: 12, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>表示の残り時間</div>
              <div style={{ fontSize: '2rem', fontWeight: 900, fontVariantNumeric: 'tabular-nums', color: 'var(--color-success)', lineHeight: 1.2 }}>
                {formatRemaining(ticketReveal.remainingMs)}
              </div>
              <div
                role="progressbar"
                aria-label="表示の残り時間"
                aria-valuemin={0}
                aria-valuemax={ticket.ticket_reveal_minutes * 60}
                aria-valuenow={Math.ceil(ticketReveal.remainingMs / 1000)}
                style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'var(--card-bg)', overflow: 'hidden' }}
              >
                <div style={{ height: '100%', width: `${Math.min(100, (ticketReveal.remainingMs / (ticket.ticket_reveal_minutes * 60_000)) * 100)}%`, background: 'var(--color-success)', transition: 'width 1s linear' }} />
              </div>
              <div style={{ marginTop: 10, fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                この画面を受付のスタッフに見せてください
              </div>
            </div>
          )}
          {ticket.status === 'used' && !ticketReveal?.visible && (
            <div style={{ marginTop: 16, textAlign: 'center', padding: 14, borderRadius: 12, border: '1px solid var(--card-border)' }}>
              <div style={{ fontWeight: 900 }}>
                {ticket.used_at ? `${formatAccountDate(ticket.used_at)} に使用` : '使用済み'}
                {usedAgo && <span style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>（{usedAgo}）</span>}
              </div>
              <div style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>受付確認用の表示時間は終了しました</div>
            </div>
          )}
          {ticket.status === 'reserved' && (
            <div style={{ marginTop: 16, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              受付でスタッフの前で「このチケットを使用する」を押してください。
              <br />押すと「使用しました」が{ticket.ticket_reveal_minutes}分間表示されます。
            </div>
          )}
        </div>
      </article>

      <div style={{ marginTop: 20 }}>
          <div className="glass-card" style={{ padding: 14, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 9 }}>
            <BadgeCheck size={20} aria-hidden="true" />
            <div>
              <small style={{ color: 'var(--text-secondary)' }}>支払い状態</small>
              <div style={{ fontWeight: 800 }}>{paymentText}</div>
              {visitSlot && ticket.payment_status === 'pending' && (
                <div style={{ marginTop: 4, fontSize: '0.88rem' }}>
                  <strong>{visitSlotPlace(visitSlot)}</strong>で支払い：<strong>{formatVisitSlot(visitSlot)}</strong>
                  {visitSlot.note && <span style={{ color: 'var(--text-secondary)' }}>（{visitSlot.note}）</span>}
                </div>
              )}
            </div>
          </div>

          {ticket.post_reservation_notes && (
            <div className="glass-card" style={{ marginBottom: 18 }}>
              <RichText content={ticket.post_reservation_notes} style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }} />
            </div>
          )}
          {ticket.use_starts_at && <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--text-secondary)', marginBottom: 14 }}><Clock3 size={17} aria-hidden="true" />使用可能：{formatAccountDate(ticket.use_starts_at)} 〜 {formatAccountDate(ticket.use_ends_at)}</div>}

          {ticket.status === 'reserved' && (
            <>
              <button type="button" className="btn btn-primary" onClick={handleUse} disabled={!useAllowed || usingTicket} style={{ width: '100%' }} aria-describedby={blockReason ? 'use-block-reason' : undefined}>
                {usingTicket ? '処理中...' : useAllowed ? 'このチケットを使用する' : '現在は使用できません'}
              </button>
              {blockReason && <p id="use-block-reason" style={{ marginTop: 10, textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>{blockReason}</p>}
            </>
          )}

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
  );
}
