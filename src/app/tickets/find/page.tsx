'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { STUDENT_EMAIL_DOMAIN } from '@/lib/config';

interface PublicEvent {
  id: string;
  title: string;
}

interface EventSlot {
  id: string;
  label: string;
  starts_at: string | null;
}

function normalizeStudentNumber(val: string): string {
  let normalized = val.replace(/[！-～]/g, (r) =>
    String.fromCharCode(r.charCodeAt(0) - 0xfee0)
  );
  normalized = normalized.replace(/\s+/g, '').toUpperCase();
  if (normalized.startsWith('S')) normalized = normalized.slice(1);
  return normalized;
}

function formatSlotLabel(slot: EventSlot): string {
  if (!slot.starts_at) return slot.label;
  const date = new Date(slot.starts_at);
  const dateLabel = date.toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  });
  return `${slot.label}（${dateLabel}）`;
}

export default function FindTicketPage() {
  const router = useRouter();
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [eventId, setEventId] = useState('');
  const [eventSlotId, setEventSlotId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [isEmailEdited, setIsEmailEdited] = useState(false);

  useEffect(() => {
    async function fetchPublicEvents() {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('id, title')
          .eq('is_public', true);

        if (!error && data) {
          setEvents(data);
          if (data.length > 0) setEventId(data[0].id);
        }
      } catch (err) {
        console.error('Error fetching public events:', err);
      } finally {
        setLoadingEvents(false);
      }
    }
    fetchPublicEvents();
  }, []);

  useEffect(() => {
    if (!eventId) {
      setSlots([]);
      setEventSlotId('');
      return;
    }

    async function fetchSlots() {
      setLoadingSlots(true);
      setEventSlotId('');
      try {
        const { data, error } = await supabase
          .from('event_slots')
          .select('id, label, starts_at')
          .eq('event_id', eventId)
          .eq('is_enabled', true)
          .order('starts_at', { ascending: true });

        if (error) {
          console.error('Error fetching event slots:', error);
          setSlots([]);
          return;
        }

        const availableSlots = data ?? [];
        setSlots(availableSlots);
        if (availableSlots.length === 1) setEventSlotId(availableSlots[0].id);
      } finally {
        setLoadingSlots(false);
      }
    }

    fetchSlots();
  }, [eventId]);

  const handleStudentNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value.replace(/\s+/g, '');
    setStudentNumber(rawVal);

    const normalized = normalizeStudentNumber(rawVal);
    if (normalized) {
      setUniversityEmail(`s${normalized.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`);
      setIsEmailEdited(false);
    } else {
      setUniversityEmail('');
      setIsEmailEdited(false);
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSearching(true);

    const cleanName = studentName.trim();
    const normalizedNumber = normalizeStudentNumber(studentNumber);
    const cleanEmail = universityEmail.trim().toLowerCase();

    if (!eventId || !eventSlotId || !cleanName || !normalizedNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
      setSearching(false);
      return;
    }

    if (!/^\d{2}[A-Z]\d{3}$/.test(normalizedNumber)) {
      setError('学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)');
      setSearching(false);
      return;
    }

    if (cleanEmail.split('@')[0] !== `s${normalizedNumber.toLowerCase()}`) {
      setError('メールアドレスのユーザー名（@の左側）が学籍番号と一致しません。');
      setSearching(false);
      return;
    }

    try {
      const { data: publicToken, error: rpcError } = await supabase.rpc('find_ticket', {
        p_event_id: eventId,
        p_event_slot_id: eventSlotId,
        p_student_name: cleanName,
        p_student_number: normalizedNumber,
        p_university_email: cleanEmail,
      });

      if (rpcError || !publicToken) {
        if (rpcError) console.error('RPC Error:', rpcError);
        setError('選択した開催枠に該当するチケットが見つかりません');
        setSearching(false);
        return;
      }

      router.push(`/tickets/${publicToken}`);
    } catch (err) {
      console.error('Error finding ticket:', err);
      setError('選択した開催枠に該当するチケットが見つかりません');
      setSearching(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          ← ホームに戻る
        </Link>
      </div>

      <div className="glass-card" style={{ maxWidth: '480px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '8px', color: 'var(--text-primary)', textAlign: 'center' }}>
          チケットの再表示・検索
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', textAlign: 'center', marginBottom: '24px' }}>
          予約券・当日券を取得した企画と開催枠を選び、取得時と同じ情報を入力してください。
        </p>

        {loadingEvents ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}><div className="loading-spinner" style={{ transform: 'scale(0.8)' }} /></div>
        ) : events.length === 0 ? (
          <div className="error-banner"><span>⚠️</span><div>現在、公開中のイベントがないため検索できません。</div></div>
        ) : (
          <form onSubmit={handleSearchSubmit}>
            {error && <div className="error-banner"><span>⚠️</span><div style={{ fontWeight: 600 }}>{error}</div></div>}

            <div className="form-group">
              <label className="form-label" htmlFor="eventId">対象企画</label>
              <select id="eventId" className="form-select" value={eventId} onChange={(e) => setEventId(e.target.value)} disabled={searching} required>
                {events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="eventSlotId">予約券・当日券を取得した開催枠</label>
              <select id="eventSlotId" className="form-select" value={eventSlotId} onChange={(e) => setEventSlotId(e.target.value)} disabled={searching || loadingSlots} required>
                <option value="">{loadingSlots ? '開催枠を読み込み中...' : '開催枠を選択してください'}</option>
                {slots.map((slot) => <option key={slot.id} value={slot.id}>{formatSlotLabel(slot)}</option>)}
              </select>
              <span className="form-hint">予約券と当日券を両方持っている場合は、表示したい券の開催枠を選んでください。</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="studentName">氏名</label>
              <input id="studentName" type="text" className="form-input" placeholder="例：山田 太郎" value={studentName} onChange={(e) => setStudentName(e.target.value)} disabled={searching} required />
              <span className="form-hint">※取得時に入力した氏名と同じ表記で入力してください</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="studentNumber">学籍番号</label>
              <input id="studentNumber" type="text" className="form-input" placeholder="例：24B123（先頭の s は入力しない）" value={studentNumber} onChange={handleStudentNumberChange} onBlur={(e) => setStudentNumber(normalizeStudentNumber(e.target.value))} disabled={searching} required style={{ textTransform: 'uppercase' }} autoCorrect="off" spellCheck={false} autoCapitalize="characters" maxLength={7} />
              <span className="form-hint" style={{ color: 'var(--color-warning)' }}>例：24B123（先頭の s は入力しない）</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="universityEmail">大学メールアドレス</label>
              <input id="universityEmail" type="email" className="form-input" placeholder={`例：s23a123@${STUDENT_EMAIL_DOMAIN}`} value={universityEmail} onChange={(e) => { setUniversityEmail(e.target.value); setIsEmailEdited(true); }} disabled={searching} required />
              {!isEmailEdited && studentNumber && <span className="form-hint" style={{ color: 'var(--color-success)', display: 'block', marginTop: '6px' }}>💡 学籍番号から自動入力しています。違う場合は修正してください。</span>}
            </div>

            <div style={{ marginTop: '30px' }}>
              <button type="submit" className="btn btn-primary" disabled={searching || loadingSlots || !eventSlotId}>
                {searching ? '検索中...' : 'チケットを検索する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
