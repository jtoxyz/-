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

function normalizeStudentNumber(val: string): string {
  // Convert full-width alphanumeric to half-width
  let normalized = val.replace(/[！-～]/g, (r) =>
    String.fromCharCode(r.charCodeAt(0) - 0xfee0)
  );
  // Remove all whitespace
  normalized = normalized.replace(/\s+/g, '');
  // Capitalize English characters
  normalized = normalized.toUpperCase();
  // Strip leading 'S' if present
  if (normalized.startsWith('S')) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

export default function FindTicketPage() {
  const router = useRouter();
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [eventId, setEventId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [isEmailEdited, setIsEmailEdited] = useState(false);

  // Fetch public events for the dropdown
  useEffect(() => {
    async function fetchPublicEvents() {
      try {
        const { data, error } = await supabase
          .from('events')
          .select('id, title')
          .eq('is_public', true);

        if (!error && data) {
          setEvents(data);
          if (data.length > 0) {
            setEventId(data[0].id);
          }
        }
      } catch (err) {
        console.error('Error fetching public events:', err);
      } finally {
        setLoadingEvents(false);
      }
    }
    fetchPublicEvents();
  }, []);

  // Handle student number change (remove whitespace, no capitalization during typing to prevent IME duplication)
  const handleStudentNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let rawVal = e.target.value;
    
    // Remove all whitespace
    rawVal = rawVal.replace(/\s+/g, '');
    
    setStudentNumber(rawVal);

    // Auto-generate email based on normalized student number
    const normalized = normalizeStudentNumber(rawVal);
    if (normalized.trim() !== '') {
      const emailUserPart = 's' + normalized.toLowerCase();
      setUniversityEmail(`${emailUserPart}@${STUDENT_EMAIL_DOMAIN}`);
      setIsEmailEdited(false);
    } else {
      setUniversityEmail('');
      setIsEmailEdited(false);
    }
  };

  const handleStudentNumberBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const normalized = normalizeStudentNumber(rawVal);
    setStudentNumber(normalized);
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSearching(true);

    const cleanName = studentName.trim();
    const normalizedNumber = normalizeStudentNumber(studentNumber);
    const cleanEmail = universityEmail.trim().toLowerCase();

    if (!eventId || !cleanName || !normalizedNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
      setSearching(false);
      return;
    }

    const studentNumberRegex = /^\d{2}[A-Z]\d{3}$/;
    if (!studentNumberRegex.test(normalizedNumber)) {
      setError('学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)');
      setSearching(false);
      return;
    }

    // Verify email matches student number
    const expectedEmailLocalPart = 's' + normalizedNumber.toLowerCase();
    const actualEmailLocalPart = cleanEmail.split('@')[0];
    if (actualEmailLocalPart !== expectedEmailLocalPart) {
      setError('メールアドレスのユーザー名（@の左側）が学籍番号と一致しません。');
      setSearching(false);
      return;
    }

    try {
      // Call find_ticket RPC to look up token
      const { data: publicToken, error: rpcError } = await supabase.rpc('find_ticket', {
        p_event_id: eventId,
        p_student_name: cleanName,
        p_student_number: normalizedNumber,
        p_university_email: cleanEmail,
      });

      if (rpcError) {
        console.error('RPC Error:', rpcError);
        setError('該当する予約が見つかりません');
        setSearching(false);
        return;
      }

      if (publicToken) {
        // Redirect to ticket page
        router.push(`/tickets/${publicToken}`);
      } else {
        // Generic error message for security (prevent student info harvesting)
        setError('該当する予約が見つかりません');
        setSearching(false);
      }
    } catch (err) {
      console.error('Error finding ticket:', err);
      setError('該当する予約が見つかりません');
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
          メールが届かない場合や、予約完了画面のリンクを失くした場合は、以下を入力してチケットを探すことができます。
        </p>

        {loadingEvents ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div className="loading-spinner" style={{ transform: 'scale(0.8)' }}></div>
          </div>
        ) : events.length === 0 ? (
          <div className="error-banner">
            <span>⚠️</span>
            <div>現在、公開中のイベントがないため検索できません。</div>
          </div>
        ) : (
          <form onSubmit={handleSearchSubmit}>
            {error && (
              <div className="error-banner">
                <span>⚠️</span>
                <div style={{ fontWeight: 600 }}>{error}</div>
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="eventId">対象企画</label>
              <select
                id="eventId"
                className="form-select"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                disabled={searching}
                required
              >
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="studentName">氏名</label>
              <input
                id="studentName"
                type="text"
                className="form-input"
                placeholder="例：山田 太郎"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                disabled={searching}
                required
              />
              <span className="form-hint">
                ※予約時に入力した氏名と同じ表記で入力してください
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="studentNumber">学籍番号</label>
              <input
                id="studentNumber"
                type="text"
                className="form-input"
                placeholder="例：24B123（先頭の s は入力しない）"
                value={studentNumber}
                onChange={handleStudentNumberChange}
                onBlur={handleStudentNumberBlur}
                disabled={searching}
                required
                style={{ textTransform: 'uppercase' }}
                autoCorrect="off"
                spellCheck={false}
                autoCapitalize="characters"
                maxLength={7}
              />
              <span className="form-hint" style={{ color: 'var(--color-warning)' }}>
                例：24B123（先頭の s は入力しない）
              </span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="universityEmail">大学メールアドレス</label>
              <input
                id="universityEmail"
                type="email"
                className="form-input"
                placeholder={`例：s23a123@${STUDENT_EMAIL_DOMAIN}`}
                value={universityEmail}
                onChange={(e) => {
                  setUniversityEmail(e.target.value);
                  setIsEmailEdited(true);
                }}
                disabled={searching}
                required
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
                disabled={searching}
              >
                {searching ? '検索中...' : 'チケットを検索する'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
