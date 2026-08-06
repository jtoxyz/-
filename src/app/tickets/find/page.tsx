'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Search, TicketCheck } from 'lucide-react';
import RichText from '@/components/RichText';
import { supabase } from '@/lib/supabase';
import { STUDENT_EMAIL_DOMAIN } from '@/lib/config';
import { type AccountEventSlot, formatAccountDate } from '@/lib/studentAccount';

const TICKET_REVEAL_MINUTES = 5;

type PublicEvent = {
  id: string;
  title: string;
};

type FoundTicket = {
  reservation_id: string;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  public_token: string;
  used_at: string | null;
  event_title: string;
  event_description: string | null;
  post_reservation_notes: string | null;
  slot_label: string | null;
};

function deriveEmail(rawStudentNumber: string): string {
  const cleaned = rawStudentNumber.trim().toLowerCase().replace(/\s+/g, '').replace(/^s/, '');
  return `s${cleaned}@${STUDENT_EMAIL_DOMAIN}`;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default function FindTicketPage() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [slots, setSlots] = useState<AccountEventSlot[]>([]);
  const [eventId, setEventId] = useState('');
  const [slotId, setSlotId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [ticket, setTicket] = useState<FoundTicket | null>(null);
  const [usingTicket, setUsingTicket] = useState(false);
  const [useError, setUseError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    supabase.rpc('get_public_events').then(({ data }) => {
      if (active) setEvents(((data as PublicEvent[] | null) || []).map((e) => ({ id: e.id, title: e.title })));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setSlotId('');
    setSlots([]);
    if (!eventId) return;
    supabase.rpc('get_event_slots', { p_event_id: eventId }).then(({ data }) => {
      if (active) setSlots((data as AccountEventSlot[] | null) || []);
    });
    return () => {
      active = false;
    };
  }, [eventId]);

  const ticketReveal = useMemo(() => {
    if (!ticket || ticket.status !== 'used' || !ticket.used_at) return null;
    const expiresAtMs = new Date(ticket.used_at).getTime() + TICKET_REVEAL_MINUTES * 60 * 1000;
    const remainingMs = expiresAtMs - nowTick;
    return remainingMs > 0 ? { visible: true as const, remainingMs } : { visible: false as const, remainingMs: 0 };
  }, [ticket, nowTick]);

  useEffect(() => {
    if (!ticketReveal?.visible) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticketReveal?.visible]);

  const handleSearch = async () => {
    if (!eventId || !slotId || !studentName.trim() || !studentNumber.trim()) return;
    setSearching(true);
    setSearchError(null);
    setTicket(null);

    const { data: token, error: findError } = await supabase.rpc('find_ticket', {
      p_event_id: eventId,
      p_event_slot_id: slotId,
      p_student_name: studentName.trim(),
      p_student_number: studentNumber.trim(),
      p_university_email: deriveEmail(studentNumber),
    });

    if (findError || !token) {
      setSearchError('見つかりませんでした。企画・枠・氏名・学籍番号を確認してください。');
      setSearching(false);
      return;
    }

    const { data: ticketRows, error: ticketError } = await supabase.rpc('get_ticket', { p_public_token: token });
    if (ticketError || !ticketRows || ticketRows.length === 0) {
      setSearchError('チケット情報を取得できませんでした。');
      setSearching(false);
      return;
    }

    setTicket(ticketRows[0] as FoundTicket);
    setSearching(false);
  };

  const handleUse = async () => {
    if (!ticket) return;
    if (!confirm(`このチケットを使用済みにします。使用後、チケットコードは${TICKET_REVEAL_MINUTES}分間だけ表示され、その後は見られなくなります。この操作は取り消せません。よろしいですか？`)) return;
    setUsingTicket(true);
    setUseError(null);

    const { error: rpcError } = await supabase.rpc('use_ticket', { p_public_token: ticket.public_token });
    if (rpcError) {
      setUseError(rpcError.message || 'チケットを使用できませんでした。');
      setUsingTicket(false);
      return;
    }

    const { data: ticketRows } = await supabase.rpc('get_ticket', { p_public_token: ticket.public_token });
    if (ticketRows && ticketRows.length > 0) setTicket(ticketRows[0] as FoundTicket);
    setUsingTicket(false);
  };

  const reset = () => {
    setTicket(null);
    setSearchError(null);
    setUseError(null);
  };

  if (ticket) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 18 }}><button type="button" className="btn btn-secondary" onClick={reset}>← 別の予約を探す</button></div>
        {useError && <div className="error-banner" style={{ marginBottom: 16 }}>{useError}</div>}

        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', textAlign: 'center', fontWeight: 900, background: ticket.status === 'used' ? 'var(--color-warning-bg)' : ticket.status === 'cancelled' ? 'rgba(244,63,94,.12)' : 'var(--color-primary-glow)', color: ticket.status === 'cancelled' ? 'var(--color-danger)' : 'var(--text-primary)' }}>
            {ticket.status === 'used' ? '使用済み' : ticket.status === 'cancelled' ? 'キャンセル済み' : ticket.ticket_type === 'walkin' ? '当日券（未使用）' : '予約券（未使用）'}
          </div>

          <div style={{ padding: 26 }}>
            <div style={{ textAlign: 'center', marginBottom: 22 }}>
              <TicketCheck size={44} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
              <h1 style={{ marginTop: 8, fontSize: '1.55rem' }}>{ticket.event_title}</h1>
              {ticket.slot_label && <div style={{ marginTop: 8, color: 'var(--text-secondary)' }}>{ticket.slot_label}</div>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 18 }}>
              <div className="glass-card" style={{ padding: 14 }}><small style={{ color: 'var(--text-secondary)' }}>氏名</small><div style={{ fontWeight: 800, marginTop: 4 }}>{ticket.student_name}</div></div>
              <div className="glass-card" style={{ padding: 14 }}><small style={{ color: 'var(--text-secondary)' }}>学籍番号</small><div style={{ fontWeight: 800, marginTop: 4 }}>{ticket.student_number}</div></div>
            </div>

            {ticket.status === 'used' && ticketReveal?.visible && (
              <div style={{ textAlign: 'center', padding: 18, borderRadius: 12, border: '2px solid var(--color-primary)', background: 'var(--color-primary-glow)', marginBottom: 18 }}>
                <small style={{ color: 'var(--text-secondary)' }}>チケットコード</small>
                <div style={{ marginTop: 5, fontSize: '2rem', fontWeight: 900, letterSpacing: '.12em' }}>{ticket.ticket_code}</div>
                <div style={{ marginTop: 8, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                  あと {formatRemaining(ticketReveal.remainingMs)} で表示が終了します
                </div>
              </div>
            )}
            {ticket.status === 'used' && !ticketReveal?.visible && (
              <div style={{ textAlign: 'center', padding: 18, borderRadius: 12, border: '2px solid var(--card-border-hover)', color: 'var(--text-secondary)', marginBottom: 18 }}>
                チケットコードの表示時間は終了しました（使用済み）
              </div>
            )}
            {ticket.status === 'reserved' && (
              <div style={{ textAlign: 'center', padding: 14, borderRadius: 12, border: '1px dashed var(--card-border-hover)', color: 'var(--text-secondary)', marginBottom: 18, fontSize: '0.85rem' }}>
                「使用する」を押すとチケットコードが表示されます（表示は{TICKET_REVEAL_MINUTES}分間のみです）
              </div>
            )}

            {ticket.post_reservation_notes && (
              <div className="glass-card" style={{ marginBottom: 18 }}>
                <RichText content={ticket.post_reservation_notes} style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }} />
              </div>
            )}

            {ticket.status === 'reserved' && (
              <button type="button" className="btn btn-primary" onClick={handleUse} disabled={usingTicket} style={{ width: '100%' }}>
                {usingTicket ? '処理中...' : 'このチケットを使用する'}
              </button>
            )}
            {ticket.status === 'used' && ticket.used_at && <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>使用日時：{formatAccountDate(ticket.used_at)}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="glass-card">
        <h1 style={{ fontSize: '1.4rem', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Search size={22} aria-hidden="true" />チケットを探す
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 20 }}>
          予約した本人以外の方が、代わりにチケットを使用する場合はこちらから予約者の氏名・学籍番号で検索してください。
        </p>

        {searchError && <div className="error-banner" style={{ marginBottom: 16 }}>{searchError}</div>}

        <div className="form-group">
          <label className="form-label" htmlFor="find-event">企画</label>
          <select id="find-event" className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            <option value="">選択してください</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
          </select>
        </div>

        {eventId && (
          <div className="form-group">
            <label className="form-label" htmlFor="find-slot">開催枠</label>
            <select id="find-slot" className="form-input" value={slotId} onChange={(e) => setSlotId(e.target.value)}>
              <option value="">選択してください</option>
              {slots.map((slot) => (
                <option key={slot.id} value={slot.id}>
                  {slot.label}{slot.starts_at ? `（${formatAccountDate(slot.starts_at)}〜）` : ''}
                </option>
              ))}
            </select>
            {slots.length === 0 && <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 6, display: 'flex', alignItems: 'center' }}><CalendarDays size={14} aria-hidden="true" style={{ marginRight: 4 }} />この企画の開催枠を取得しています...</p>}
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="find-name">予約者の氏名</label>
          <input id="find-name" type="text" className="form-input" value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="予約時に登録した氏名をそのまま入力" />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="find-number">予約者の学籍番号</label>
          <input id="find-number" type="text" className="form-input" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} placeholder="例：26E244" />
        </div>

        <button
          type="button"
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={searching || !eventId || !slotId || !studentName.trim() || !studentNumber.trim()}
          style={{ width: '100%', marginTop: 8 }}
        >
          {searching ? '検索中...' : '探す'}
        </button>
      </div>
    </div>
  );
}
