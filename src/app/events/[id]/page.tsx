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
  total_capacity: number;
  reservation_capacity: number;
  reserved_count: number;
  walkin_count: number;
  remaining_reservation_slots: number;
  remaining_walkin_slots: number;
  is_enabled: boolean;
  sort_order: number;
  remaining_slots: number;
  reservation_starts_at: string | null;
  reservation_ends_at: string | null;
  ticket_use_starts_at: string | null;
  ticket_use_ends_at: string | null;
  walkin_starts_at: string | null;
  walkin_ends_at: string | null;
  is_reservation_enabled: boolean;
  is_ticket_use_enabled: boolean;
  is_walkin_enabled: boolean;
  walkin_limit: number | null;
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

  const handleWalkinSubmit = async (e: React.MouseEvent) => {
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

    // Validate exactly one slot is selected
    if (selectedSlotIds.length !== 1) {
      setError('当日券を取得する枠を1つだけ選択してください。');
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
      const { data, error: rpcError } = await supabase.rpc('create_walkin_reservation', {
        p_event_id: id,
        p_event_slot_id: selectedSlotIds[0],
        p_student_name: cleanName,
        p_student_number: normalizedNumber,
        p_university_email: cleanEmail,
      });

      if (rpcError) {
        setError(rpcError.message || '当日券の取得に失敗しました。');
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
      console.error('Error reserving walkin ticket:', err);
      setError('当日券取得処理中にエラーが発生しました。時間をおいてやり直してください。');
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
          <h2 style={{ fontSize: '1.5rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
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
                  background: 'var(--card-bg)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--card-border)',
                  color: 'var(--text-primary)',
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

  // Form is shown if there are any slots where reservation or walk-in is active or upcoming
  const shouldShowForm = slots.length > 0 && slots.some((s) => {
    if (!s.is_enabled) return false;
    
    // Check if reservation is active or upcoming
    const resEnds = s.reservation_ends_at ? new Date(s.reservation_ends_at) : null;
    const resActiveOrUpcoming = s.is_reservation_enabled && s.remaining_reservation_slots > 0 && (!resEnds || now <= resEnds);

    // Check if walk-in is active or upcoming
    const walkEnds = s.walkin_ends_at ? new Date(s.walkin_ends_at) : null;
    const walkActiveOrUpcoming = s.is_walkin_enabled && s.remaining_walkin_slots > 0 && (!walkEnds || now <= walkEnds);

    return resActiveOrUpcoming || walkActiveOrUpcoming;
  });

  const selectedSlot = selectedSlotIds.length === 1
    ? slots.find((s) => s.id === selectedSlotIds[0])
    : null;

  const walkinButtonText = (() => {
    if (selectedSlotIds.length === 0) return '当日券を取得する（開催枠を選択してください）';
    if (selectedSlotIds.length > 1) return '当日券を取得する（開催枠を1つだけ選択してください）';
    
    if (!selectedSlot) return '当日券を取得する';
    if (!selectedSlot.is_enabled || !selectedSlot.is_walkin_enabled) return '当日券受付停止中';
    if (selectedSlot.remaining_walkin_slots <= 0) return '当日券満員（定員到達）';
    
    const starts = selectedSlot.walkin_starts_at ? new Date(selectedSlot.walkin_starts_at) : null;
    const ends = selectedSlot.walkin_ends_at ? new Date(selectedSlot.walkin_ends_at) : null;
    
    if (starts && now < starts) {
      const dateStr = starts.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' });
      const timeStr = starts.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `当日券受付前（${dateStr} ${timeStr} 受付開始）`;
    }
    if (ends && now > ends) return '当日券受付終了';
    
    return '当日券を取得する';
  })();

  const isReservationButtonEnabled = (() => {
    if (booking) return false;
    if (selectedSlotIds.length === 0) return false;
    return selectedSlotIds.every((id) => {
      const s = slots.find((slot) => slot.id === id);
      if (!s || !s.is_enabled || !s.is_reservation_enabled) return false;
      if (s.remaining_reservation_slots <= 0) return false;
      
      const starts = s.reservation_starts_at ? new Date(s.reservation_starts_at) : null;
      const ends = s.reservation_ends_at ? new Date(s.reservation_ends_at) : null;
      return (!starts || now >= starts) && (!ends || now <= ends);
    });
  })();

  const isWalkinButtonEnabled = (() => {
    if (booking) return false;
    if (selectedSlotIds.length !== 1) return false;
    if (!selectedSlot) return false;
    if (!selectedSlot.is_enabled || !selectedSlot.is_walkin_enabled) return false;
    if (selectedSlot.remaining_walkin_slots <= 0) return false;
    
    const starts = selectedSlot.walkin_starts_at ? new Date(selectedSlot.walkin_starts_at) : null;
    const ends = selectedSlot.walkin_ends_at ? new Date(selectedSlot.walkin_ends_at) : null;
    return (!starts || now >= starts) && (!ends || now <= ends);
  })();

  const totalRemainingRes = slots.reduce((sum, s) => sum + s.remaining_reservation_slots, 0);
  const totalRemainingWalkin = slots.reduce((sum, s) => sum + s.remaining_walkin_slots, 0);

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <Link href="/" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          ← 一覧に戻る
        </Link>
      </div>

      <div className="event-detail-layout">
        {/* Info column */}
        <div>
          <div className="glass-card">
        <h1 style={{ fontSize: '1.75rem', marginBottom: '12px', color: 'var(--text-primary)' }}>{event.title}</h1>
        {event.description && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '24px', whiteSpace: 'pre-wrap' }}>
            {event.description}
          </p>
        )}

        <div className="event-info-grid" style={{ background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
          <div className="info-label">開催日時</div>
          <div className="info-value" style={{ fontWeight: 600 }}>{formatDateTime(event.starts_at)}</div>

          <div className="info-label">受付期間</div>
          <div className="info-value">
            {event.reservation_starts_at ? formatDateTime(event.reservation_starts_at) : '制限なし'} 〜 <br />
            {event.reservation_ends_at ? formatDateTime(event.reservation_ends_at) : '制限なし'}
          </div>

          <div className="info-label">定員状況</div>
          <div className="info-value">
            予約券残り: <span style={{ color: totalRemainingRes > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 700 }}>{totalRemainingRes}</span> 席 / 
            当日券残り: <span style={{ color: totalRemainingWalkin > 0 ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 700 }}>{totalRemainingWalkin}</span> 席
          </div>
        </div>
          </div>
        </div>

        {/* Operation column */}
        <div>

      {/* Slot selection UI */}
      {slots.length > 0 && (
        <div className="glass-card">
          <h2 style={{ fontSize: '1.25rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>🕐</span> 参加枠を選択{event.slot_selection_mode === 'multiple' ? '（複数選択可）' : ''}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {slots.map((slot) => {
              const isDisabled = !slot.is_enabled;
              const isReservationFull = slot.remaining_reservation_slots <= 0;
              const isWalkinFull = slot.remaining_walkin_slots <= 0;
              const isSelectable = !isDisabled && (!isReservationFull || !isWalkinFull);
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
                        ? 'var(--card-bg)'
                        : 'var(--card-bg)',
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
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{slot.label}</span>
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
                      {!isDisabled && isReservationFull && isWalkinFull && (
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
                        予約券残り: <span style={{ color: slot.remaining_reservation_slots > 0 ? 'var(--color-success)' : 'var(--color-danger)', fontWeight: 600 }}>{slot.remaining_reservation_slots}</span> / {slot.reservation_capacity} 席
                      </span>
                      <span>
                        当日券残り: <span style={{ color: slot.remaining_walkin_slots > 0 ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 600 }}>{slot.remaining_walkin_slots}</span> 席
                      </span>
                    </div>
                    {slot.is_reservation_enabled && (slot.reservation_starts_at || slot.reservation_ends_at) && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                        予約受付期間: {slot.reservation_starts_at ? formatDateTime(slot.reservation_starts_at) : '制限なし'} 〜 {slot.reservation_ends_at ? formatDateTime(slot.reservation_ends_at) : '制限なし'}
                      </div>
                    )}
                    {slot.is_walkin_enabled && (slot.walkin_starts_at || slot.walkin_ends_at) && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        当日券発行期間: {slot.walkin_starts_at ? formatDateTime(slot.walkin_starts_at) : '制限なし'} 〜 {slot.walkin_ends_at ? formatDateTime(slot.walkin_ends_at) : '制限なし'}
                      </div>
                    )}
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

        {!shouldShowForm ? (
          <div className="error-banner" style={{ margin: 0 }}>
            <span>⚠️</span>
            <div>
              {slots.length === 0
                ? '現在この企画は予約できません。（開催枠が設定されていません）'
                : '現在この企画は予約できません。(すべての受付期間が終了しているか定員に達しています)'}
            </div>
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

            <div style={{
              margin: '20px 0',
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              background: 'rgba(245, 158, 11, 0.05)',
              border: '1px solid var(--color-warning-border)',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)',
              lineHeight: '1.5'
            }}>
              <strong style={{ color: 'var(--color-warning)', display: 'block', marginBottom: '4px' }}>💡 当日券に関する注意事項</strong>
              • 当日券は先着順です。<br />
              • 同じ日の予約券を取得済みの場合、その日の当日券は取得できません。<br />
              • 同じ企画でも別日であれば、予約していない日の当日券は取得できます。
            </div>

            <div className="btn-group-responsive" style={{ marginTop: '20px' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={booking || !isReservationButtonEnabled}
                style={{ opacity: isReservationButtonEnabled ? 1 : 0.5 }}
              >
                {booking ? '予約処理中...' : '予約券を取得する'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleWalkinSubmit}
                disabled={booking || !isWalkinButtonEnabled}
                style={{
                  borderColor: isWalkinButtonEnabled ? 'var(--color-warning-border)' : 'var(--card-border)',
                  color: isWalkinButtonEnabled ? 'var(--color-warning)' : 'var(--text-muted)',
                  opacity: isWalkinButtonEnabled ? 1 : 0.5
                }}
              >
                {booking ? '当日券処理中...' : walkinButtonText}
              </button>
            </div>
          </form>
        )}
      </div>
      </div>
      </div>
    </div>
  );
}
