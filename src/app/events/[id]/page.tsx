'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { saveToken } from '@/lib/ticketCache';
import { ALLOWED_EMAIL_DOMAINS, STUDENT_EMAIL_DOMAIN } from '@/lib/config';

interface EventSlot {
  id: string;
  label: string;
  starts_at: string | null;
  ends_at: string | null;
  capacity: number;
  is_enabled: boolean;
  sort_order: number;
  remaining_slots: number;
}

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
  slot_selection_mode: 'single' | 'multiple';
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
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<string[]>([]);
  const [bookingResults, setBookingResults] = useState<Array<{slot_label: string; public_token: string}> | null>(null);

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

        // Fetch event slots
        const { data: slotsData } = await supabase.rpc('get_event_slots', { p_event_id: id });
        if (slotsData && Array.isArray(slotsData)) {
          setSlots(slotsData);
        }
      } catch (err) {
        console.error('Error fetching event details:', err);
        setError('データの取得に失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchEventDetails();
  }, [id]);

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

  // Handle email changes (mark as manually modified)
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUniversityEmail(e.target.value);
    setIsEmailEdited(true);
  };

  const handleSlotToggle = (slotId: string) => {
    if (!event) return;
    if (event.slot_selection_mode === 'single') {
      setSelectedSlotIds([slotId]);
    } else {
      setSelectedSlotIds((prev) =>
        prev.includes(slotId)
          ? prev.filter((s) => s !== slotId)
          : [...prev, slotId]
      );
    }
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBooking(true);

    const cleanName = studentName.trim();
    const normalizedNumber = normalizeStudentNumber(studentNumber);
    const cleanEmail = universityEmail.trim().toLowerCase();

    // Validations
    if (!cleanName || !normalizedNumber || !cleanEmail) {
      setError('すべての項目を入力してください。');
      setBooking(false);
      return;
    }

    // Validate at least one slot is selected
    if (selectedSlotIds.length === 0) {
      setError('参加する枠を選択してください。');
      setBooking(false);
      return;
    }

    // Student number regex validation
    const studentNumberRegex = /^\d{2}[A-Z]\d{3}$/;
    if (!studentNumberRegex.test(normalizedNumber)) {
      setError('学籍番号は「数字2桁 + 英字1文字 + 数字3桁」の形式で入力してください。(例: 24B123)');
      setBooking(false);
      return;
    }

    // Verify email matches student number
    const expectedEmailLocalPart = 's' + normalizedNumber.toLowerCase();
    const actualEmailLocalPart = cleanEmail.split('@')[0];
    if (actualEmailLocalPart !== expectedEmailLocalPart) {
      setError('メールアドレスのユーザー名（@の左側）が学籍番号と一致しません。');
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
      if (event?.slot_selection_mode === 'multiple' && selectedSlotIds.length > 1) {
        // Bulk reservation for multiple slots
        const { data, error: rpcError } = await supabase.rpc('create_reservations_bulk', {
          p_event_id: id,
          p_event_slot_ids: selectedSlotIds,
          p_student_name: cleanName,
          p_student_number: normalizedNumber,
          p_university_email: cleanEmail,
        });

        if (rpcError) {
          setError(rpcError.message || '予約の作成に失敗しました。');
          setBooking(false);
          return;
        }

        const parsedData: Array<{slot_label: string; public_token: string}> = typeof data === 'string' ? JSON.parse(data) : data;
        if (parsedData && Array.isArray(parsedData)) {
          for (const result of parsedData) {
            saveToken(result.public_token);
          }
          setBookingResults(parsedData);
          setBooking(false);
        } else {
          setError('予期しないデータが返されました。');
          setBooking(false);
        }
      } else {
        // Single slot reservation
        const { data, error: rpcError } = await supabase.rpc('create_reservation', {
          p_event_id: id,
          p_event_slot_id: selectedSlotIds[0],
          p_student_name: cleanName,
          p_student_number: normalizedNumber,
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

  // Show completion screen for bulk booking results
  if (bookingResults) {
    return (
      <div>
        <div className="glass-card" style={{ borderTop: '4px solid var(--color-success)' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
            <span>🎉</span> 予約が完了しました
          </h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
            以下の枠に予約が確定しました。各チケットのリンクから詳細を確認できます。
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {bookingResults.map((result) => (
              <Link
                key={result.public_token}
                href={`/tickets/${result.public_token}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 18px',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--card-border)',
                  color: '#ffffff',
                  textDecoration: 'none',
                  transition: 'background 0.2s',
                }}
              >
                <span style={{ fontWeight: 600 }}>🎫 {result.slot_label}</span>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-primary)' }}>チケットを表示 →</span>
              </Link>
            ))}
          </div>
          <div style={{ marginTop: '30px' }}>
            <Link href="/">
              <button className="btn btn-secondary">企画一覧へ戻る</button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Calculate if booking is active
  const now = new Date();
  const totalRemainingSlots = slots.length > 0
    ? slots.reduce((sum, s) => sum + s.remaining_slots, 0)
    : event.remaining_slots;
  const isReservationOpen = event.reservation_enabled &&
    (!event.reservation_starts_at || new Date(event.reservation_starts_at) <= now) &&
    (!event.reservation_ends_at || new Date(event.reservation_ends_at) >= now) &&
    totalRemainingSlots > 0 &&
    slots.length > 0;

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
            定員 {event.capacity} 名 / 残り <span style={{ color: totalRemainingSlots > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>{totalRemainingSlots}</span> 席
          </div>
        </div>
      </div>

      {/* Slot selection UI */}
      {slots.length > 0 && (
        <div className="glass-card">
          <h2 style={{ fontSize: '1.25rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🕐</span> 参加枠を選択{event.slot_selection_mode === 'multiple' ? '（複数選択可）' : ''}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {slots.map((slot) => {
              const isDisabled = !slot.is_enabled;
              const isFull = slot.remaining_slots <= 0;
              const isSelectable = !isDisabled && !isFull;
              const isSelected = selectedSlotIds.includes(slot.id);

              return (
                <label
                  key={slot.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '14px 16px',
                    background: isSelected
                      ? 'rgba(99, 102, 241, 0.15)'
                      : isSelectable
                        ? 'rgba(255,255,255,0.04)'
                        : 'rgba(255,255,255,0.02)',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected
                      ? '2px solid var(--color-primary)'
                      : '1px solid var(--card-border)',
                    cursor: isSelectable ? 'pointer' : 'not-allowed',
                    opacity: isSelectable ? 1 : 0.5,
                    transition: 'all 0.2s',
                  }}
                >
                  <input
                    type={event.slot_selection_mode === 'single' ? 'radio' : 'checkbox'}
                    name="event-slot"
                    checked={isSelected}
                    disabled={!isSelectable}
                    onChange={() => handleSlotToggle(slot.id)}
                    style={{ accentColor: 'var(--color-primary)', width: '18px', height: '18px', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, color: '#ffffff', fontSize: '0.95rem' }}>{slot.label}</span>
                      {isDisabled && (
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          background: 'rgba(156, 163, 175, 0.3)',
                          color: 'var(--text-secondary)',
                          fontWeight: 600,
                        }}>受付停止</span>
                      )}
                      {!isDisabled && isFull && (
                        <span style={{
                          fontSize: '0.7rem',
                          padding: '2px 8px',
                          borderRadius: '9999px',
                          background: 'rgba(239, 68, 68, 0.2)',
                          color: 'var(--color-danger)',
                          fontWeight: 600,
                        }}>満席</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
                      {(slot.starts_at || slot.ends_at) && (
                        <span>
                          {formatDateTime(slot.starts_at)} 〜 {formatDateTime(slot.ends_at)}
                        </span>
                      )}
                      <span>
                        残り <span style={{ color: slot.remaining_slots > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>{slot.remaining_slots}</span> / {slot.capacity} 席
                      </span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

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
                placeholder="例：24B123（先頭の s は入力しない）"
                required
                value={studentNumber}
                onChange={handleStudentNumberChange}
                onBlur={handleStudentNumberBlur}
                disabled={booking}
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
