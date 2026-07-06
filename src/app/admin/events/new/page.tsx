'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

interface SlotFormRow {
  id: string; // temp client-side ID
  label: string;
  date: string; // 開催日 (YYYY-MM-DD)
  startTime: string; // 開始時刻 (HH:mm)
  endTime: string; // 終了時刻 (HH:mm)
  reservationStartsAt: string; // 通常予約開始日時 (datetime-local string)
  reservationEndsAt: string; // 通常予約終了日時 (datetime-local string)
  ticketUseStartsAt: string; // チケット使用開始日時 (datetime-local string)
  ticketUseEndsAt: string; // チケット使用終了日時 (datetime-local string)
  walkinStartsAt: string; // 当日券発行開始日時 (datetime-local string)
  walkinEndsAt: string; // 当日券発行終了日時 (datetime-local string)
  isReservationEnabled: boolean;
  isTicketUseEnabled: boolean;
  isWalkinEnabled: boolean;
  walkinLimit: string; // 当日券上限数 (string for input binding)
  capacity: number; // 予約枠 (reservation_capacity)
  totalCapacity: number; // 総参加枠
}

function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return true; // Empty is valid since it is optional
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

export default function AdminNewEventPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  
  // Date/Time strings (empty string represents null)
  const [reservationStartsAt, setReservationStartsAt] = useState('');
  const [reservationEndsAt, setReservationEndsAt] = useState('');
  const [useStartsAt, setUseStartsAt] = useState('');
  const [useEndsAt, setUseEndsAt] = useState('');

  // Slot selection mode
  const [slotSelectionMode, setSlotSelectionMode] = useState<'single' | 'multiple'>('single');

  // Dynamic slot rows
  const [slotRows, setSlotRows] = useState<SlotFormRow[]>([{
    id: crypto.randomUUID(),
    label: '',
    date: '',
    startTime: '',
    endTime: '',
    reservationStartsAt: '',
    reservationEndsAt: '',
    ticketUseStartsAt: '',
    ticketUseEndsAt: '',
    walkinStartsAt: '',
    walkinEndsAt: '',
    isReservationEnabled: true,
    isTicketUseEnabled: true,
    isWalkinEnabled: true,
    walkinLimit: '',
    capacity: 50,
    totalCapacity: 50
  }]);

  // Toggles
  const [isPublic, setIsPublic] = useState(false);
  const [reservationEnabled, setReservationEnabled] = useState(true);
  const [ticketEnabled, setTicketEnabled] = useState(false);
  const [useButtonEnabled, setUseButtonEnabled] = useState(false);

  // Allowed domains
  const [allowedDomains, setAllowedDomains] = useState('ge.osaka-sandai.ac.jp');

  // Survey settings
  const [surveyAfterReservationEnabled, setSurveyAfterReservationEnabled] = useState(false);
  const [surveyAfterReservationUrl, setSurveyAfterReservationUrl] = useState('');
  const [surveyAfterReservationMessage, setSurveyAfterReservationMessage] = useState(
    '今後の企画改善のため、アンケートにご協力ください。'
  );

  const [surveyAfterUseEnabled, setSurveyAfterUseEnabled] = useState(false);
  const [surveyAfterUseUrl, setSurveyAfterUseUrl] = useState('');
  const [surveyAfterUseMessage, setSurveyAfterUseMessage] = useState(
    'ご参加ありがとうございました。今後の企画改善のため、アンケートにご協力ください。'
  );

  // Slot row helpers
  const updateSlotRow = (slotId: string, field: keyof SlotFormRow, value: any) => {
    setSlotRows((prev) => prev.map((row) => {
      if (row.id !== slotId) return row;
      const updated = { ...row, [field]: value };
      
      // If date changes, automatically set up initial default times for separate timing windows
      if (field === 'date' && typeof value === 'string' && value) {
        if (!updated.startTime) updated.startTime = '11:00';
        if (!updated.endTime) updated.endTime = '14:00';
        
        // 通常予約 (Normal Reservation): Starts 10 days before at 09:00, Ends 3 days before at 23:59
        if (!updated.reservationStartsAt) {
          const d = new Date(value);
          d.setDate(d.getDate() - 10);
          const pad = (n: number) => n.toString().padStart(2, '0');
          updated.reservationStartsAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
        }
        if (!updated.reservationEndsAt) {
          const d = new Date(value);
          d.setDate(d.getDate() - 3);
          const pad = (n: number) => n.toString().padStart(2, '0');
          updated.reservationEndsAt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59`;
        }
        
        // チケット使用 (Ticket usage): Matches event slot hours (e.g. 11:00 - 14:00)
        if (!updated.ticketUseStartsAt) updated.ticketUseStartsAt = `${value}T11:00`;
        if (!updated.ticketUseEndsAt) updated.ticketUseEndsAt = `${value}T14:00`;
        
        // 当日券 (Walk-in): Starts 30 mins before event slot, ends 30 mins before slot ends (e.g. 10:30 - 13:30)
        if (!updated.walkinStartsAt) updated.walkinStartsAt = `${value}T10:30`;
        if (!updated.walkinEndsAt) updated.walkinEndsAt = `${value}T13:30`;
      }
      return updated;
    }));
  };

  const addSlotRow = () => {
    setSlotRows((prev) => [...prev, {
      id: crypto.randomUUID(),
      label: '',
      date: '',
      startTime: '',
      endTime: '',
      reservationStartsAt: '',
      reservationEndsAt: '',
      ticketUseStartsAt: '',
      ticketUseEndsAt: '',
      walkinStartsAt: '',
      walkinEndsAt: '',
      isReservationEnabled: true,
      isTicketUseEnabled: true,
      isWalkinEnabled: true,
      walkinLimit: '',
      capacity: 50,
      totalCapacity: 50
    }]);
  };

  const removeSlotRow = (slotId: string) => {
    setSlotRows((prev) => prev.length <= 1 ? prev : prev.filter((row) => row.id !== slotId));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    // Basic validation
    if (!title.trim()) {
      setError('企画名を入力してください。');
      setSaving(false);
      return;
    }

    // Slot validation: at least 1 row with a label
    if (slotRows.length === 0 || !slotRows.some((row) => row.label.trim())) {
      setError('開催枠を少なくとも1つ入力し、枠名を設定してください。');
      setSaving(false);
      return;
    }

    // Date/time and capacity validation
    for (const row of slotRows) {
      const slotName = row.label || '無題の枠';
      if (!row.date) {
        setError(`開催枠「${slotName}」の開催日を入力してください。`);
        setSaving(false);
        return;
      }
      if (!row.startTime) {
        setError(`開催枠「${slotName}」の開始時刻を入力してください。`);
        setSaving(false);
        return;
      }
      if (!row.endTime) {
        setError(`開催枠「${slotName}」の終了時刻を入力してください。`);
        setSaving(false);
        return;
      }
      if (row.endTime <= row.startTime) {
        setError(`開催枠「${slotName}」で、終了時刻は開始時刻より後に設定してください。`);
        setSaving(false);
        return;
      }

      // Reservation timing validation
      if (row.isReservationEnabled) {
        if (!row.reservationStartsAt) {
          setError(`開催枠「${slotName}」の通常予約開始日時を入力してください。`);
          setSaving(false);
          return;
        }
        if (!row.reservationEndsAt) {
          setError(`開催枠「${slotName}」の通常予約終了日時を入力してください。`);
          setSaving(false);
          return;
        }
        if (row.reservationEndsAt <= row.reservationStartsAt) {
          setError(`開催枠「${slotName}」で、通常予約の終了日時は開始日時より後に設定してください。`);
          setSaving(false);
          return;
        }
      }

      // Ticket use timing validation
      if (row.isTicketUseEnabled) {
        if (!row.ticketUseStartsAt) {
          setError(`開催枠「${slotName}」のチケット使用開始日時を入力してください。`);
          setSaving(false);
          return;
        }
        if (!row.ticketUseEndsAt) {
          setError(`開催枠「${slotName}」のチケット使用終了日時を入力してください。`);
          setSaving(false);
          return;
        }
        if (row.ticketUseEndsAt <= row.ticketUseStartsAt) {
          setError(`開催枠「${slotName}」で、チケット使用の終了日時は開始日時より後に設定してください。`);
          setSaving(false);
          return;
        }
      }

      // Walkin ticket timing validation
      if (row.isWalkinEnabled) {
        if (!row.walkinStartsAt) {
          setError(`開催枠「${slotName}」の当日券発行開始日時を入力してください。`);
          setSaving(false);
          return;
        }
        if (!row.walkinEndsAt) {
          setError(`開催枠「${slotName}」の当日券発行終了日時を入力してください。`);
          setSaving(false);
          return;
        }
        if (row.walkinEndsAt <= row.walkinStartsAt) {
          setError(`開催枠「${slotName}」で、当日券発行の終了日時は開始日時より後に設定してください。`);
          setSaving(false);
          return;
        }
      }

      if (row.totalCapacity < 0 || row.capacity < 0) {
        setError(`開催枠「${slotName}」で、定員は0以上に設定してください。`);
        setSaving(false);
        return;
      }
      if (row.capacity > row.totalCapacity) {
        setError(`開催枠「${slotName}」で、予約枠が総参加枠を超えています（予約枠: ${row.capacity} / 総参加枠: ${row.totalCapacity}）。予約枠は総参加枠以下に設定してください。`);
        setSaving(false);
        return;
      }
    }

    // Survey URL validation
    if (surveyAfterReservationEnabled && surveyAfterReservationUrl) {
      if (!isValidUrl(surveyAfterReservationUrl)) {
        setError('予約完了後アンケートのURLは http:// または https:// の形式で入力してください。');
        setSaving(false);
        return;
      }
    }
    if (surveyAfterUseEnabled && surveyAfterUseUrl) {
      if (!isValidUrl(surveyAfterUseUrl)) {
        setError('使用後アンケートのURLは http:// または https:// の形式で入力してください。');
        setSaving(false);
        return;
      }
    }

    // Domain normalization
    const domainsArray = allowedDomains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d !== '');

    if (domainsArray.length === 0) {
      setError('許可するメールドメインを少なくとも1つ入力してください。');
      setSaving(false);
      return;
    }

    // Helper: combine date + time into ISO string
    const combineDateTime = (dateStr: string, timeStr: string): string | null => {
      if (!dateStr || !timeStr) return null;
      const [year, month, day] = dateStr.split('-').map(Number);
      const [hours, minutes] = timeStr.split(':').map(Number);
      const date = new Date(year, month - 1, day, hours, minutes);
      return date.toISOString();
    };

    // Helper: parse datetime-local string to ISO string
    const parseToIso = (dtStr: string): string | null => {
      if (!dtStr) return null;
      return new Date(dtStr).toISOString();
    };

    // Backward compat: use first slot's values for event-level fields
    const firstSlot = slotRows[0];

    // Prepare data
    const eventData = {
      title: title.trim(),
      description: description.trim() || null,
      capacity: firstSlot.capacity,
      starts_at: combineDateTime(firstSlot.date, firstSlot.startTime),
      ends_at: combineDateTime(firstSlot.date, firstSlot.endTime),
      reservation_starts_at: reservationStartsAt ? new Date(reservationStartsAt).toISOString() : null,
      reservation_ends_at: reservationEndsAt ? new Date(reservationEndsAt).toISOString() : null,
      use_starts_at: useStartsAt ? new Date(useStartsAt).toISOString() : null,
      use_ends_at: useEndsAt ? new Date(useEndsAt).toISOString() : null,
      is_public: isPublic,
      reservation_enabled: reservationEnabled,
      ticket_enabled: ticketEnabled,
      use_button_enabled: useButtonEnabled,
      allowed_email_domains: domainsArray,
      slot_selection_mode: slotSelectionMode,
      survey_after_reservation_enabled: surveyAfterReservationEnabled,
      survey_after_reservation_url: surveyAfterReservationUrl.trim() || null,
      survey_after_reservation_message: surveyAfterReservationMessage.trim() || null,
      survey_after_use_enabled: surveyAfterUseEnabled,
      survey_after_use_url: surveyAfterUseUrl.trim() || null,
      survey_after_use_message: surveyAfterUseMessage.trim() || null,
    };

    try {
      const { data, error: insertError } = await supabase
        .from('events')
        .insert(eventData)
        .select()
        .single();

      if (insertError) {
        setError(insertError.message || '企画の作成に失敗しました。');
        setSaving(false);
        return;
      }

      // Insert slot rows into event_slots
      const { error: slotsError } = await supabase
        .from('event_slots')
        .insert(slotRows.map((row, i) => ({
          event_id: data.id,
          label: row.label.trim(),
          starts_at: combineDateTime(row.date, row.startTime),
          ends_at: combineDateTime(row.date, row.endTime),
          reservation_capacity: row.capacity,
          total_capacity: row.totalCapacity,
          reservation_starts_at: parseToIso(row.reservationStartsAt),
          reservation_ends_at: parseToIso(row.reservationEndsAt),
          ticket_use_starts_at: parseToIso(row.ticketUseStartsAt),
          ticket_use_ends_at: parseToIso(row.ticketUseEndsAt),
          walkin_starts_at: parseToIso(row.walkinStartsAt),
          walkin_ends_at: parseToIso(row.walkinEndsAt),
          is_reservation_enabled: row.isReservationEnabled,
          is_ticket_use_enabled: row.isTicketUseEnabled,
          is_walkin_enabled: row.isWalkinEnabled,
          walkin_limit: row.walkinLimit.trim() !== '' ? parseInt(row.walkinLimit) : null,
          is_enabled: true,
          sort_order: i,
        })));

      if (slotsError) {
        console.error('Error inserting event_slots:', slotsError);
        // Transaction safety: clean up the created event
        await supabase.from('events').delete().eq('id', data.id);
        setError(`企画の作成に失敗しました（開催枠の保存エラー: ${slotsError.message || '不明なエラー'}）。`);
        setSaving(false);
        return;
      }

      // Success: Redirect to dashboard
      router.push('/admin/events');
    } catch (err) {
      console.error('Error creating event:', err);
      setError('サーバー処理中にエラーが発生しました。');
      setSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
      <AdminNav />

      <div className="form-container-responsive">

      <div style={{ marginBottom: '20px' }}>
        <Link href="/admin/events" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          ← 企画一覧に戻る
        </Link>
      </div>

      <div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: '24px', color: 'var(--text-primary)' }}>
          新規企画の作成
        </h1>

        {error && (
          <div className="error-banner">
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Section: Basic details */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              1. 企画基本情報
            </h3>
            
            <div className="form-group">
              <label className="form-label" htmlFor="title">企画名</label>
              <input
                id="title"
                type="text"
                className="form-input"
                placeholder="例：大学学園祭 チケット引換"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="description">説明文</label>
              <textarea
                id="description"
                className="form-input"
                rows={4}
                placeholder="企画の内容や、引き換え時の注意事項を入力します。"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
            </div>



            <div className="form-group">
              <label className="form-label" htmlFor="allowedDomains">許可する大学メールのドメイン (カンマ区切り)</label>
              <input
                id="allowedDomains"
                type="text"
                className="form-input"
                placeholder="ge.osaka-sandai.ac.jp,osaka-sandai.ac.jp"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                disabled={saving}
              />
              <span className="form-hint">複数のドメインを許可する場合は、カンマ(,)で区切って入力してください。</span>
            </div>
          </div>

          {/* Section: Timings & Slots */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              2. 日程・受付時間設定
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="reservationStartsAt">予約受付開始日時</label>
                <input
                  id="reservationStartsAt"
                  type="datetime-local"
                  className="form-input"
                  value={reservationStartsAt}
                  onChange={(e) => setReservationStartsAt(e.target.value)}
                  disabled={saving}
                />
                <span className="form-hint">空欄の場合は、即時受付可能とみなされます。</span>
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="reservationEndsAt">予約受付終了日時</label>
                <input
                  id="reservationEndsAt"
                  type="datetime-local"
                  className="form-input"
                  value={reservationEndsAt}
                  onChange={(e) => setReservationEndsAt(e.target.value)}
                  disabled={saving}
                />
                <span className="form-hint">空欄の場合は、期限なしとみなされます。</span>
              </div>
            </div>

            {/* Slot selection mode */}
            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-label">枠選択モード</label>
              <div style={{ display: 'flex', gap: '24px', marginTop: '4px' }}>
                <label className="form-checkbox-label">
                  <input
                    type="radio"
                    name="slotSelectionMode"
                    className="form-checkbox"
                    checked={slotSelectionMode === 'single'}
                    onChange={() => setSlotSelectionMode('single')}
                    disabled={saving}
                  />
                  1つだけ選択（単一枠）
                </label>
                <label className="form-checkbox-label">
                  <input
                    type="radio"
                    name="slotSelectionMode"
                    className="form-checkbox"
                    checked={slotSelectionMode === 'multiple'}
                    onChange={() => setSlotSelectionMode('multiple')}
                    disabled={saving}
                  />
                  複数選択可能
                </label>
              </div>
              <span className="form-hint">ユーザーが予約時に選択できる開催枠の数を制限します。</span>
            </div>

            {/* Slot management */}
            <div style={{ marginTop: '20px', background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', color: 'var(--text-primary)' }}>開催枠の管理</h4>
              <span className="form-hint" style={{ display: 'block', marginBottom: '12px' }}>各開催枠に、枠名・開催日時・定員を設定できます。少なくとも1つの枠が必要です。</span>

              {slotRows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    marginBottom: '12px',
                    padding: '16px',
                    background: 'var(--card-bg)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--card-border)',
                  }}
                >
                  {/* Row 1: 枠名 */}
                  <div style={{ marginBottom: '12px' }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>枠名</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="例：午前の部"
                      value={row.label}
                      onChange={(e) => updateSlotRow(row.id, 'label', e.target.value)}
                      disabled={saving}
                      style={{ width: '100%' }}
                    />
                  </div>

                  {/* Row 2: 開催日 */}
                  <div style={{ marginBottom: '12px' }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>開催日</label>
                    <input
                      type="date"
                      className="form-input"
                      value={row.date}
                      onChange={(e) => updateSlotRow(row.id, 'date', e.target.value)}
                      disabled={saving}
                      style={{ width: '100%', minWidth: 0 }}
                    />
                  </div>

                  {/* Row 3: 開始時刻 / 終了時刻 */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                    gap: '12px',
                    marginBottom: '12px',
                  }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>開始時刻</label>
                      <input
                        type="time"
                        className="form-input"
                        value={row.startTime}
                        onChange={(e) => updateSlotRow(row.id, 'startTime', e.target.value)}
                        disabled={saving}
                        style={{ width: '100%', minWidth: 0 }}
                      />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>終了時刻</label>
                      <input
                        type="time"
                        className="form-input"
                        value={row.endTime}
                        onChange={(e) => updateSlotRow(row.id, 'endTime', e.target.value)}
                        disabled={saving}
                        style={{ width: '100%', minWidth: 0 }}
                      />
                    </div>
                  </div>

                  {/* Row 3.5 (New): Timings & Limits Configuration */}
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    marginBottom: '16px',
                    padding: '16px',
                    border: '1px solid var(--card-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--card-bg)'
                  }}>
                    {/* 1. 通常予約受付期間 */}
                    <div style={{ paddingBottom: '12px', borderBottom: '1px dashed var(--card-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>通常予約受付期間</span>
                        <label className="form-checkbox-label" style={{ fontSize: '0.75rem' }}>
                          <input
                            type="checkbox"
                            className="form-checkbox"
                            checked={row.isReservationEnabled}
                            onChange={(e) => updateSlotRow(row.id, 'isReservationEnabled', e.target.checked)}
                            disabled={saving}
                          />
                          予約受付を有効にする
                        </label>
                      </div>
                      <span className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>この開催枠に対する通常の事前予約を受け付ける期間を設定します。</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>予約開始日時</label>
                          <input
                            type="datetime-local"
                            className="form-input"
                            value={row.reservationStartsAt}
                            onChange={(e) => updateSlotRow(row.id, 'reservationStartsAt', e.target.value)}
                            disabled={saving || !row.isReservationEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>予約終了日時</label>
                          <input
                            type="datetime-local"
                            className="form-input"
                            value={row.reservationEndsAt}
                            onChange={(e) => updateSlotRow(row.id, 'reservationEndsAt', e.target.value)}
                            disabled={saving || !row.isReservationEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 2. チケット使用可能期間 */}
                    <div style={{ paddingBottom: '12px', borderBottom: '1px dashed var(--card-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-success)' }}>チケット使用可能期間</span>
                        <label className="form-checkbox-label" style={{ fontSize: '0.75rem' }}>
                          <input
                            type="checkbox"
                            className="form-checkbox"
                            checked={row.isTicketUseEnabled}
                            onChange={(e) => updateSlotRow(row.id, 'isTicketUseEnabled', e.target.checked)}
                            disabled={saving}
                          />
                          チケット使用を有効にする
                        </label>
                      </div>
                      <span className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>
                        取得済みの予約券および当日券を、この画面で「使用する（引き換え）」ことができる時間帯です。
                      </span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>使用開始日時</label>
                          <input
                            type="datetime-local"
                            className="form-input"
                            value={row.ticketUseStartsAt}
                            onChange={(e) => updateSlotRow(row.id, 'ticketUseStartsAt', e.target.value)}
                            disabled={saving || !row.isTicketUseEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>使用終了日時</label>
                          <input
                            type="datetime-local"
                            className="form-input"
                            value={row.ticketUseEndsAt}
                            onChange={(e) => updateSlotRow(row.id, 'ticketUseEndsAt', e.target.value)}
                            disabled={saving || !row.isTicketUseEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* 3. 当日券発行期間 */}
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-warning)' }}>当日券発行期間＆上限</span>
                        <label className="form-checkbox-label" style={{ fontSize: '0.75rem' }}>
                          <input
                            type="checkbox"
                            className="form-checkbox"
                            checked={row.isWalkinEnabled}
                            onChange={(e) => updateSlotRow(row.id, 'isWalkinEnabled', e.target.checked)}
                            disabled={saving}
                          />
                          当日券発行を有効にする
                        </label>
                      </div>
                      <span className="form-hint" style={{ display: 'block', marginBottom: '8px' }}>
                        この開催枠で当日券の発行を受け付ける期間と上限数を設定します（残席数と当日券上限数の小さい方が上限になります）。
                      </span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>発行開始日時</label>
                          <input
                            type="datetime-local"
                            className="form-input"
                            value={row.walkinStartsAt}
                            onChange={(e) => updateSlotRow(row.id, 'walkinStartsAt', e.target.value)}
                            disabled={saving || !row.isWalkinEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>発行終了日時</label>
                          <input
                            type="datetime-local"
                            className="form-input"
                            value={row.walkinEndsAt}
                            onChange={(e) => updateSlotRow(row.id, 'walkinEndsAt', e.target.value)}
                            disabled={saving || !row.isWalkinEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                        <div>
                          <label className="form-label" style={{ fontSize: '0.7rem' }}>当日券発行上限数（空欄で制限なし）</label>
                          <input
                            type="number"
                            className="form-input"
                            placeholder="残席すべて"
                            min={0}
                            value={row.walkinLimit}
                            onChange={(e) => updateSlotRow(row.id, 'walkinLimit', e.target.value)}
                            disabled={saving || !row.isWalkinEnabled}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>

                      {/* Config warning message */}
                      {row.isWalkinEnabled && row.isReservationEnabled && row.walkinStartsAt && row.reservationEndsAt && (new Date(row.walkinStartsAt) < new Date(row.reservationEndsAt)) && (
                        <div style={{
                          marginTop: '12px',
                          padding: '8px 12px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'rgba(245, 158, 11, 0.1)',
                          border: '1px solid rgba(245, 158, 11, 0.3)',
                          color: 'var(--color-warning)',
                          fontSize: '0.78rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                        }}>
                          <span>⚠️</span>
                          <span>通常予約の終了日時より前に、当日券の発行期間が開始されています。設定ミスの可能性があります。</span>
                        </div>
                      )}
                    </div>
                  </div>            

                  {/* Row 4: 総参加枠 / 予約枠 */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: '12px',
                    marginBottom: '12px',
                  }}>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>総参加枠</label>
                      <input
                        type="number"
                        className="form-input"
                        min={0}
                        value={row.totalCapacity}
                        onChange={(e) => updateSlotRow(row.id, 'totalCapacity', parseInt(e.target.value) || 0)}
                        disabled={saving}
                        style={{ width: '100%', minWidth: 0 }}
                      />
                    </div>
                    <div>
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>予約枠</label>
                      <input
                        type="number"
                        className="form-input"
                        min={0}
                        value={row.capacity}
                        onChange={(e) => updateSlotRow(row.id, 'capacity', parseInt(e.target.value) || 0)}
                        disabled={saving}
                        style={{ width: '100%', minWidth: 0 }}
                      />
                    </div>
                  </div>

                  {/* Row 5: 削除ボタン */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => removeSlotRow(row.id)}
                      disabled={saving || slotRows.length <= 1}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--color-danger-border)',
                        color: 'var(--color-danger)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 16px',
                        cursor: slotRows.length <= 1 ? 'not-allowed' : 'pointer',
                        opacity: slotRows.length <= 1 ? 0.3 : 1,
                        fontSize: '0.85rem',
                      }}
                    >
                      🗑 この枠を削除
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addSlotRow}
                disabled={saving}
                style={{
                  background: 'transparent',
                  border: '1px dashed var(--card-border)',
                  color: 'var(--color-primary)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  marginTop: '4px',
                  width: '100%',
                }}
              >
                + 枠を追加
              </button>
            </div>
          </div>

          {/* Section: Ticket features */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              3. 電子チケット・使用ボタン設定
            </h3>
            
            <div className="form-group">
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={ticketEnabled}
                  onChange={(e) => {
                    setTicketEnabled(e.target.checked);
                    if (!e.target.checked) setUseButtonEnabled(false);
                  }}
                  disabled={saving}
                />
                電子チケット機能（引き換えコード）を有効にする
              </label>
              <span className="form-hint" style={{ marginLeft: '28px' }}>有効にすると、予約完了画面にチケットコード・表示ボタンが出現します。</span>
            </div>

            {ticketEnabled && (
              <>
                <div className="form-group" style={{ marginLeft: '24px' }}>
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={useButtonEnabled}
                      onChange={(e) => setUseButtonEnabled(e.target.checked)}
                      disabled={saving}
                    />
                    「使用する」ボタンを有効にする (店員前でのタップ認証)
                  </label>
                  <span className="form-hint" style={{ marginLeft: '28px' }}>有効にすると、ユーザーが自身で「使用」状態に変更可能になります。</span>
                </div>

                <div style={{ marginLeft: '24px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  💡 チケットの使用可能時間は、各開催枠の「予約券使用時間」「当日券受付時間」で設定してください。
                </div>
              </>
            )}
          </div>

          {/* Section: Surveys */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              4. 外部アンケート連携 (Googleフォーム等)
            </h3>

            {/* Reservation survey */}
            <div style={{ marginBottom: '20px', background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={surveyAfterReservationEnabled}
                    onChange={(e) => setSurveyAfterReservationEnabled(e.target.checked)}
                    disabled={saving}
                  />
                  予約完了後にアンケートを表示する
                </label>
              </div>

              {surveyAfterReservationEnabled && (
                <>
                  <div className="form-group">
                    <label className="form-label" htmlFor="surveyAfterReservationUrl">アンケートURL</label>
                    <input
                      id="surveyAfterReservationUrl"
                      type="text"
                      className="form-input"
                      placeholder="https://docs.google.com/forms/.../viewform"
                      value={surveyAfterReservationUrl}
                      onChange={(e) => setSurveyAfterReservationUrl(e.target.value)}
                      disabled={saving}
                      required={surveyAfterReservationEnabled}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="surveyAfterReservationMessage">表示用メッセージ</label>
                    <input
                      id="surveyAfterReservationMessage"
                      type="text"
                      className="form-input"
                      value={surveyAfterReservationMessage}
                      onChange={(e) => setSurveyAfterReservationMessage(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Ticket use survey */}
            {ticketEnabled && useButtonEnabled && (
              <div style={{ background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
                <div className="form-group">
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={surveyAfterUseEnabled}
                      onChange={(e) => setSurveyAfterUseEnabled(e.target.checked)}
                      disabled={saving}
                    />
                    チケット使用（引き換え）後にアンケートを表示する
                  </label>
                </div>

                {surveyAfterUseEnabled && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="surveyAfterUseUrl">アンケートURL</label>
                      <input
                        id="surveyAfterUseUrl"
                        type="text"
                        className="form-input"
                        placeholder="https://docs.google.com/forms/.../viewform"
                        value={surveyAfterUseUrl}
                        onChange={(e) => setSurveyAfterUseUrl(e.target.value)}
                        disabled={saving}
                        required={surveyAfterUseEnabled}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="surveyAfterUseMessage">表示用メッセージ</label>
                      <input
                        id="surveyAfterUseMessage"
                        type="text"
                        className="form-input"
                        value={surveyAfterUseMessage}
                        onChange={(e) => setSurveyAfterUseMessage(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section: Status */}
          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              5. 公開設定
            </h3>
            
            <div style={{ display: 'flex', gap: '24px' }}>
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    disabled={saving}
                  />
                  企画を一般公開する (一覧に表示されます)
                </label>
              </div>

              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={reservationEnabled}
                    onChange={(e) => setReservationEnabled(e.target.checked)}
                    disabled={saving}
                  />
                  予約の受付を有効にする
                </label>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <Link href="/admin/events" style={{ flex: 1 }}>
              <button type="button" className="btn btn-secondary" disabled={saving}>
                キャンセル
              </button>
            </Link>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
              {saving ? '保存中...' : '企画を作成する'}
            </button>
          </div>
        </form>
      </div>
      </div>
      </div>
    </div>
  );
}
