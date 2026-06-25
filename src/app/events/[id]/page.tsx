'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { saveToken } from '@/lib/ticketCache';
import { ALLOWED_EMAIL_DOMAINS, STUDENT_EMAIL_DOMAIN } from '@/lib/config';

interface EventDetails {
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

function normalizeStudentNumber(val: string): string {
  // Convert full-width alphanumeric to half-width
  let normalized = val.replace(/[！-～]/g, (r) =>
    String.fromCharCode(r.charCodeAt(0) - 0xfee0)
  );
  // Remove all whitespace
  normalized = normalized.replace(/\s+/g, '');
  // Capitalize English characters
  return normalized.toUpperCase();
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

export default function EventBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [isEmailEdited, setIsEmailEdited] = useState(false);

  useEffect(() => {
    async function fetchEventDetails() {
      try {
        // Query event details via supabase. since anonymous clients can only read is_public = true events
        const { data, error } = await supabase
          .from('events')
          .select('*')
          .eq('id', id)
          .eq('is_public', true)
          .single();

        if (error || !data) {
          setError('企画が見つからないか、公開されていません。');
          setLoading(false);
          return;
        }

        // To get remaining seats securely, we can run get_public_events RPC and filter by ID
        const { data: publicEvents } = await supabase.rpc('get_public_events');
        const matched = publicEvents?.find((e: { id: string }) => e.id === id);

        setEvent({
          ...data,
          remaining_slots: matched ? matched.remaining_slots : data.capacity,
        });
      } catch (err) {
        console.error('Error fetching event details:', err);
        setError('データの取得に失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchEventDetails();
  }, [id]);

  // Handle student number change (uppercase + full-to-half-width conversion + auto email generation)
  const handleStudentNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const normalized = normalizeStudentNumber(rawVal);
    
    setStudentNumber(normalized);

    // Auto-generate email s[student_number_lowercase]@[STUDENT_EMAIL_DOMAIN]
    if (normalized.trim() !== '') {
      let emailUserPart = normalized.toLowerCase();
      if (!emailUserPart.startsWith('s')) {
        emailUserPart = 's' + emailUserPart;
      }
      setUniversityEmail(`${emailUserPart}@${STUDENT_EMAIL_DOMAIN}`);
      setIsEmailEdited(false);
    } else {
      setUniversityEmail('');
      setIsEmailEdited(false);
    }
  };

  // Handle email changes (mark as manually modified)
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUniversityEmail(e.target.value);
    setIsEmailEdited(true);
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBooking(true);

    const cleanName = studentName.trim();
    const cleanNumber = studentNumber.trim();
    const cleanEmail = universityEmail.trim().toLowerCase();

    // Validations
    if (!cleanName || !cleanNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
      setBooking(false);
      return;
    }

    // Domain validation on frontend
    const domain = cleanEmail.split('@')[1];
    if (!domain || !ALLOWED_EMAIL_DOMAINS.includes(domain)) {
      setError(`許可されている大学のメールアドレスを入力してください。(${ALLOWED_EMAIL_DOMAINS.join(', ')})`);
      setBooking(false);
      return;
    }

    try {
      // Execute booking via create_reservation RPC
      const { data, error: rpcError } = await supabase.rpc('create_reservation', {
        p_event_id: id,
        p_student_name: cleanName,
        p_student_number: cleanNumber,
        p_university_email: cleanEmail,
      });

      if (rpcError) {
        setError(rpcError.message || '予約の作成に失敗しました。');
        setBooking(false);
        return;
      }

      // Success: Save token to localStorage & cookie cache
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      if (parsedData && parsedData.public_token) {
        saveToken(parsedData.public_token);
        // Redirect to ticket page
        router.push(`/tickets/${parsedData.public_token}`);
      } else {
        setError('予期しないデータが返されました。');
        setBooking(false);
      }
    } catch (err) {
      console.error('Error reserving ticket:', err);
      setError('予約処理中にエラーが発生しました。時間をおいてやり直してください。');
      setBooking(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>企画情報を読み込んでいます...</p>
      </div>
    );
  }

  if (error && !event) {
    return (
      <div className="glass-card text-center" style={{ padding: '40px 20px' }}>
        <div className="error-banner" style={{ display: 'inline-flex', marginBottom: '24px' }}>
          <span>⚠️</span>
          <div>{error}</div>
        </div>
        <div>
          <Link href="/">
            <button className="btn btn-secondary btn-sm">一覧に戻る</button>
          </Link>
        </div>
      </div>
    );
  }

  if (!event) return null;

  // Calculate if booking is active
  const now = new Date();
  const isReservationOpen = event.reservation_enabled &&
    (!event.reservation_starts_at || new Date(event.reservation_starts_at) <= now) &&
    (!event.reservation_ends_at || new Date(event.reservation_ends_at) >= now) &&
    event.remaining_slots > 0;

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          ← 一覧に戻る
        </Link>
      </div>

      <div className="glass-card">
        <h1 style={{ fontSize: '1.75rem', marginBottom: '12px', color: '#ffffff' }}>{event.title}</h1>
        {event.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '24px', whiteSpace: 'pre-wrap' }}>
            {event.description}
          </p>
        )}

        <div className="event-info-grid" style={{ background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
          <div className="info-label">開催日時</div>
          <div className="info-value" style={{ fontWeight: 600 }}>{formatDateTime(event.starts_at)}</div>

          <div className="info-label">受付期間</div>
          <div className="info-value">
            {event.reservation_starts_at ? formatDateTime(event.reservation_starts_at) : '制限なし'} 〜 <br />
            {event.reservation_ends_at ? formatDateTime(event.reservation_ends_at) : '制限なし'}
          </div>

          <div className="info-label">定員状況</div>
          <div className="info-value">
            定員 {event.capacity} 名 / 残り <span style={{ color: event.remaining_slots > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>{event.remaining_slots}</span> 席
          </div>
        </div>
      </div>

      <div className="glass-card" style={{ borderTop: '4px solid var(--color-primary)' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>📝</span> 参加予約フォーム
        </h2>

        {!isReservationOpen ? (
          <div className="error-banner" style={{ margin: 0 }}>
            <span>⚠️</span>
            <div>現在この企画は予約できません。(受付期間外または定員に達しています)</div>
          </div>
        ) : (
          <form onSubmit={handleBookingSubmit}>
            {error && (
              <div className="error-banner">
                <span>⚠️</span>
                <div>{error}</div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="studentName">氏名</label>
              <input
                id="studentName"
                type="text"
                className="form-input"
                placeholder="例：山田 太郎"
                required
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                disabled={booking}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="studentNumber">学籍番号</label>
              <input
                id="studentNumber"
                type="text"
                className="form-input"
                placeholder="例：23A123"
                required
                value={studentNumber}
                onChange={handleStudentNumberChange}
                disabled={booking}
              />
              <span className="form-hint" style={{ color: 'var(--color-warning)' }}>
                ※先頭の s はつけずに入力してください（自動変換されます）
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="universityEmail">大学メールアドレス</label>
              <input
                id="universityEmail"
                type="email"
                className="form-input"
                placeholder={`例：s23a123@${STUDENT_EMAIL_DOMAIN}`}
                required
                value={universityEmail}
                onChange={handleEmailChange}
                disabled={booking}
              />
              {!isEmailEdited && studentNumber && (
                <span className="form-hint" style={{ color: 'var(--color-success)', display: 'block', marginTop: '6px' }}>
                  💡 学籍番号から自動入力しています。違う場合は修正してください。
                </span>
              )}
            </div>

            <div style={{ marginTop: '30px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={booking}
              >
                {booking ? '予約処理中...' : 'この内容で予約を確定する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
