'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarPlus, Copy, Eye, Trash2, TriangleAlert } from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import EventPreviewModal from '@/components/EventPreviewModal';
import FormatToolbar from '@/components/admin/FormatToolbar';
import { adminSupabase as supabase } from '@/lib/supabase';
import PaymentVisitSettings from '@/components/admin/PaymentVisitSettings';
import OptionalSection from '@/components/admin/OptionalSection';
import { DEFAULT_ALLOWED_DOMAINS, DEFAULT_LOW_REMAINING_THRESHOLD, DEFAULT_LOW_REMAINING_THRESHOLD_TYPE, shiftSlotTimingByDays } from '@/lib/eventFormDefaults';
import { applySlotTimingChange } from '@/lib/slotTiming';
import { formatJstShort, jstDateTimeToIso, jstLocalToIso } from '@/lib/jst';

interface SlotFormRow {
  id: string; // temp client-side ID
  label: string;
  date: string; // 開催日 (YYYY-MM-DD)
  startTime: string; // 開始時刻 (HH:mm)
  endTime: string; // 終了時刻 (HH:mm)
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
  } catch {
    return false;
  }
}

export default function AdminNewEventPage() {
  const { loading: authLoading } = useAdminAuth();
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 保存ボタンはページの下にあるので、エラーが出たらページ上部のエラー表示まで移動する
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [error]);

  // Preview state
  const [showPreview, setShowPreview] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  
  // Date/Time strings (empty string represents null)
  // 企画全体の使用可能期間は今は各開催枠で設定する（旧項目。空のまま保存する）
  const [useStartsAt] = useState('');
  const [useEndsAt] = useState('');

  // 予約受付期間は企画全体で共通（保存時に全開催枠へ同じ値を書き込む）
  const [reservationStartsAt, setReservationStartsAt] = useState('');
  const [reservationEndsAt, setReservationEndsAt] = useState('');
  const [blockWeekendHolidayReservations, setBlockWeekendHolidayReservations] = useState(false);

  // Slot selection mode
  const [slotSelectionMode, setSlotSelectionMode] = useState<'single' | 'multiple'>('single');

  const [showAdvancedTiming, setShowAdvancedTiming] = useState(false);

  // Dynamic slot rows
  const [slotRows, setSlotRows] = useState<SlotFormRow[]>([{
    id: crypto.randomUUID(),
    label: '',
    date: '',
    startTime: '',
    endTime: '',
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
  const [ticketRevealMinutes, setTicketRevealMinutes] = useState('5');

  // Allowed domains
  const [allowedDomains, setAllowedDomains] = useState(DEFAULT_ALLOWED_DOMAINS);

  // 毎回は使わない設定（チェックを入れたときだけ入力欄を出す。外すと標準値で保存）
  const [useCustomDomains, setUseCustomDomains] = useState(false);
  const [usePostReservationNotes, setUsePostReservationNotes] = useState(false);
  const [useCustomThreshold, setUseCustomThreshold] = useState(false);
  const [useAutoStop, setUseAutoStop] = useState(false);

  // Survey settings
  const [surveyAfterReservationEnabled, setSurveyAfterReservationEnabled] = useState(false);
  const [surveyAfterReservationUrl, setSurveyAfterReservationUrl] = useState('');
  const [surveyAfterReservationMessage, setSurveyAfterReservationMessage] = useState(
    '今後の企画改善のため、アンケートにご協力ください。'
  );

  const [surveyAfterUseEnabled, setSurveyAfterUseEnabled] = useState(false);
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [paymentVisitRequired, setPaymentVisitRequired] = useState(false);
  const [paymentVisitWindowDays, setPaymentVisitWindowDays] = useState<number | null>(1);
  const [surveyAfterUseUrl, setSurveyAfterUseUrl] = useState('');
  const [surveyAfterUseMessage, setSurveyAfterUseMessage] = useState(
    'ご参加ありがとうございました。今後の企画改善のため、アンケートにご協力ください。'
  );

  // Slot row helpers

  // New features
  const [autoSuspendAt, setAutoSuspendAt] = useState('');
  const [autoHideAt, setAutoHideAt] = useState('');
  const [postReservationNotes, setPostReservationNotes] = useState('');
  const [lowRemainingThreshold, setLowRemainingThreshold] = useState(String(DEFAULT_LOW_REMAINING_THRESHOLD));
  const [lowRemainingThresholdType, setLowRemainingThresholdType] = useState<'count' | 'percent'>(DEFAULT_LOW_REMAINING_THRESHOLD_TYPE);

  // Slot row helpers
  const updateSlotRow = <K extends keyof SlotFormRow>(slotId: string, field: K, value: SlotFormRow[K]) => {
    setSlotRows((prev) => prev.map((row) => {
      if (row.id !== slotId) return row;
      const next = applySlotTimingChange(row, field, value);
      // 予約枠が総参加枠と同じ（当日券分を分けていない）なら、総参加枠の変更に合わせる
      if (field === 'totalCapacity' && row.capacity === row.totalCapacity) next.capacity = next.totalCapacity;
      return next;
    }));
  };

  const addSlotRow = () => {
    setSlotRows((prev) => [...prev, {
      id: crypto.randomUUID(),
      label: '',
      date: '',
      startTime: '',
      endTime: '',
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
    setSlotRows((prev) => prev.filter((row) => row.id !== slotId));
  };

  const duplicateSlotRow = (slotId: string) => {
    setSlotRows((prev) => {
      const rowIndex = prev.findIndex(r => r.id === slotId);
      if (rowIndex === -1) return prev;
      const target = prev[rowIndex];
      const newRow = {
        ...target,
        id: crypto.randomUUID(),
        label: target.label ? `${target.label}（コピー）` : 'コピー',
      };
      const newRows = [...prev];
      newRows.splice(rowIndex + 1, 0, newRow);
      return newRows;
    });
  };

  // 複数日開催向け：同じ時間帯の枠を翌日にコピーする
  const duplicateSlotToNextDay = (slotId: string) => {
    setSlotRows((prev) => {
      const rowIndex = prev.findIndex(r => r.id === slotId);
      if (rowIndex === -1) return prev;
      const newRow = { ...shiftSlotTimingByDays(prev[rowIndex], 1), id: crypto.randomUUID() };
      const newRows = [...prev];
      newRows.splice(rowIndex + 1, 0, newRow);
      return newRows;
    });
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
    const unnamedIndex = slotRows.findIndex((row) => !row.label.trim());
    if (unnamedIndex >= 0) {
      setError(`${unnamedIndex + 1}番目の開催枠に枠名を入力してください。`);
      setSaving(false);
      return;
    }

    // 予約受付期間（企画全体）
    if (slotRows.some((row) => row.isReservationEnabled)) {
      if (!reservationStartsAt || !reservationEndsAt) {
        setError('予約受付期間の開始日時と終了日時を入力してください。');
        setSaving(false);
        return;
      }
      if (reservationEndsAt <= reservationStartsAt) {
        setError('予約受付期間の終了日時は開始日時より後に設定してください。');
        setSaving(false);
        return;
      }
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
    const domainsArray = (useCustomDomains ? allowedDomains : DEFAULT_ALLOWED_DOMAINS)
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d !== '');

    if (domainsArray.length === 0) {
      setError('許可するメールドメインを少なくとも1つ入力してください。');
      setSaving(false);
      return;
    }

    // Helper: combine date + time into ISO string
    // 開催日・時刻は日本時間として扱う（端末のタイムゾーンに左右されない）
    const combineDateTime = (dateStr: string, timeStr: string): string | null => jstDateTimeToIso(dateStr, timeStr);

    // Helper: parse datetime-local string to ISO string
    const parseToIso = (dtStr: string): string | null => jstLocalToIso(dtStr);

    // Backward compat: use first slot's values for event-level fields
    const firstSlot = slotRows[0];

    // Prepare data
    const eventData = {
      title: title.trim(),
      description: description.trim() || null,
      capacity: firstSlot.capacity,
      starts_at: combineDateTime(firstSlot.date, firstSlot.startTime),
      ends_at: combineDateTime(firstSlot.date, firstSlot.endTime),
      reservation_starts_at: parseToIso(reservationStartsAt),
      reservation_ends_at: parseToIso(reservationEndsAt),
      block_weekend_holiday_reservations: blockWeekendHolidayReservations,
      use_starts_at: jstLocalToIso(useStartsAt),
      use_ends_at: jstLocalToIso(useEndsAt),
      is_public: isPublic,
      reservation_enabled: reservationEnabled,
      ticket_enabled: ticketEnabled,
      use_button_enabled: useButtonEnabled,
      ticket_reveal_minutes: Math.min(60, Math.max(1, parseInt(ticketRevealMinutes, 10) || 5)),
      allowed_email_domains: domainsArray,
      slot_selection_mode: slotSelectionMode,
      survey_after_reservation_enabled: surveyAfterReservationEnabled,
      survey_after_reservation_url: surveyAfterReservationUrl.trim() || null,
      survey_after_reservation_message: surveyAfterReservationMessage.trim() || null,
      survey_after_use_enabled: surveyAfterUseEnabled,
      survey_after_use_url: surveyAfterUseUrl.trim() || null,
      survey_after_use_message: surveyAfterUseMessage.trim() || null,
      payment_required: paymentRequired,
      payment_visit_required: paymentRequired && paymentVisitRequired,
      payment_visit_window_days: paymentVisitWindowDays,
      is_reservation_suspended: false,
      is_walkin_suspended: false,
      is_ticket_use_suspended: false,
      auto_suspend_at: useAutoStop ? jstLocalToIso(autoSuspendAt) : null,
      auto_hide_at: useAutoStop ? jstLocalToIso(autoHideAt) : null,
      post_reservation_notes: usePostReservationNotes ? postReservationNotes.trim() || null : null,
      low_remaining_threshold: !useCustomThreshold || Number.isNaN(parseInt(lowRemainingThreshold, 10)) ? DEFAULT_LOW_REMAINING_THRESHOLD : Math.max(0, parseInt(lowRemainingThreshold, 10)),
      low_remaining_threshold_type: useCustomThreshold ? lowRemainingThresholdType : DEFAULT_LOW_REMAINING_THRESHOLD_TYPE,
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
          reservation_starts_at: parseToIso(reservationStartsAt),
          reservation_ends_at: parseToIso(reservationEndsAt),
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

      // 券種・アンケートは企画IDが必要なので、作成後は編集画面に移って続きを設定できるようにする
      router.push(`/admin/event?id=${data.id}`);
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '12px' }}>
          <h1 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--text-primary)' }}>
            新規企画の作成
          </h1>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              onClick={() => setShowPreview(true)}
            >
              <Eye size={16} aria-hidden="true" />プレビュー
            </button>
          </div>
        </div>

        {error && (
          <div className="error-banner" role="alert" ref={errorRef} tabIndex={-1}>
            <TriangleAlert size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
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
              <label className="form-label" htmlFor="description" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <span>説明文（専用タグやMarkdown記法が使用可能です）</span>
              </label>
              <FormatToolbar targetId="description" onChange={setDescription} disabled={saving} />
              <textarea
                id="description"
                className="form-input"
                rows={4}
                placeholder="企画の内容や、引き換え時の注意事項を入力します。"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
              <span className="form-hint">文字を太字にしたり、リンクを貼ったりできます。</span>
            </div>


            <OptionalSection
              label="予約後の注意事項を表示する"
              hint="持ち物や集合時間など、利用者のチケット画面の上に出すお知らせです。"
              checked={usePostReservationNotes}
              onChange={setUsePostReservationNotes}
              disabled={saving}
            >
              <FormatToolbar targetId="postReservationNotes" onChange={setPostReservationNotes} disabled={saving} />
              <textarea
                id="postReservationNotes"
                aria-label="予約完了後の注意事項"
                className="form-input"
                rows={3}
                placeholder="例：当日は学生証を必ず持参してください。10分前には集合してください。"
                value={postReservationNotes}
                onChange={(e) => setPostReservationNotes(e.target.value)}
                disabled={saving}
              />
            </OptionalSection>

            <OptionalSection
              label="予約できる大学メールのドメインを変更する"
              hint={`チェックしない場合は ${DEFAULT_ALLOWED_DOMAINS} のみ予約できます。`}
              checked={useCustomDomains}
              onChange={setUseCustomDomains}
              disabled={saving}
            >
              <input
                id="allowedDomains"
                aria-label="許可する大学メールのドメイン"
                type="text"
                className="form-input"
                placeholder="ge.osaka-sandai.ac.jp,osaka-sandai.ac.jp"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                disabled={saving}
              />
              <span className="form-hint">複数のドメインを許可する場合は、カンマ(,)で区切って入力してください。</span>
            </OptionalSection>
          </div>

          {/* Section: Timings & Slots */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              2. 日程・受付時間設定
            </h3>

            {/* 予約受付期間（企画全体で共通） */}
            <div className="form-group" style={{ background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <label className="form-label" style={{ marginBottom: '8px' }}>予約受付期間（企画全体で共通）</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div>
                  <label className="form-label" htmlFor="reservationStartsAt" style={{ fontSize: '0.75rem' }}>受付開始日時</label>
                  <input
                    id="reservationStartsAt"
                    type="datetime-local"
                    className="form-input"
                    value={reservationStartsAt}
                    onChange={(e) => setReservationStartsAt(e.target.value)}
                    disabled={saving}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label className="form-label" htmlFor="reservationEndsAt" style={{ fontSize: '0.75rem' }}>受付終了日時</label>
                  <input
                    id="reservationEndsAt"
                    type="datetime-local"
                    className="form-input"
                    value={reservationEndsAt}
                    onChange={(e) => setReservationEndsAt(e.target.value)}
                    disabled={saving}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
              <span className="form-hint" style={{ marginTop: '8px' }}>
                この期間中、すべての開催枠で事前予約を受け付けます。予約を受け付けない枠は、下の各枠で「この枠で予約を受け付ける」を外してください。
              </span>
              <label className="form-checkbox-label" style={{ marginTop: '12px' }}>
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={blockWeekendHolidayReservations}
                  onChange={(e) => setBlockWeekendHolidayReservations(e.target.checked)}
                  disabled={saving}
                />
                土日祝日は予約を受け付けない
              </label>
              <span className="form-hint">
                ONにすると、受付期間中でも土曜・日曜・祝日（日本時間）は予約できません。当日券は対象外です。
              </span>
            </div>

            {/* Slot selection mode */}
            <div className="form-group" style={{ marginTop: '16px' }}>
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={slotSelectionMode === 'multiple'}
                  onChange={(e) => setSlotSelectionMode(e.target.checked ? 'multiple' : 'single')}
                  disabled={saving}
                />
                1人が複数の開催枠をまとめて予約できるようにする
              </label>
              <span className="form-hint" style={{ marginLeft: 28 }}>チェックしない場合、1人1枠だけ予約できます（券種を設定した企画は常に1枠です）。</span>
            </div>

            {/* Remaining Threshold Setting */}
            <OptionalSection
              label="「残りわずか」と表示する基準を変更する"
              hint={`チェックしない場合は、残り${DEFAULT_LOW_REMAINING_THRESHOLD}人以下で「残りわずか」と表示します。`}
              checked={useCustomThreshold}
              onChange={setUseCustomThreshold}
              disabled={saving}
            >
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem' }}>残り</span>
                <input
                  type="number"
                  aria-label="残りわずか表示の基準値"
                  className="form-input"
                  style={{ width: '120px' }}
                  min="0"
                  value={lowRemainingThreshold}
                  onChange={(e) => setLowRemainingThreshold(e.target.value)}
                  disabled={saving}
                />
                <select
                  aria-label="基準の単位"
                  className="form-input"
                  style={{ width: '120px' }}
                  value={lowRemainingThresholdType}
                  onChange={(e) => setLowRemainingThresholdType(e.target.value as 'count' | 'percent')}
                  disabled={saving}
                >
                  <option value="count">人以下</option>
                  <option value="percent">%以下</option>
                </select>
              </div>
              <span className="form-hint" style={{ marginTop: '8px' }}>
                基準より多く残っていれば「余裕あり」、定員に達したら「満席」と表示されます。
              </span>
            </OptionalSection>

            {/* Slot management */}
            <div className="slot-panel" style={{ marginTop: '20px', background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: '12px' }}>
                <h4 style={{ fontSize: '0.95rem', margin: 0, color: 'var(--text-primary)' }}>開催枠の管理</h4>
                <button
                  type="button"
                  onClick={() => setShowAdvancedTiming((v) => !v)}
                  style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontSize: '0.78rem', cursor: 'pointer', textDecoration: 'underline', whiteSpace: 'nowrap' }}
                >
                  {showAdvancedTiming ? '詳細設定を隠す' : '詳細設定を表示'}
                </button>
              </div>
              <span className="form-hint" style={{ display: 'block', marginBottom: '12px' }}>
                各開催枠に、枠名・開催日時・定員を設定できます。少なくとも1つの枠が必要です。チケット使用時間や当日券の時間は開催日を入れると自動で設定されるので、普段は「詳細設定」を開かなくても大丈夫です。
              </span>

              {slotRows.map((row) => (
                <div
                  key={row.id}
                  className="slot-row"
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
                  <div className="slot-timing" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    marginBottom: '16px',
                    padding: '16px',
                    border: '1px solid var(--card-border)',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--card-bg)'
                  }}>
                    {/* 1. 事前予約（期間は企画全体の「予約受付期間」） */}
                    <div style={{ paddingBottom: '12px', borderBottom: '1px dashed var(--card-border)' }}>
                      <label className="form-checkbox-label" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                        <input
                          type="checkbox"
                          className="form-checkbox"
                          checked={row.isReservationEnabled}
                          onChange={(e) => updateSlotRow(row.id, 'isReservationEnabled', e.target.checked)}
                          disabled={saving}
                        />
                        この枠で予約を受け付ける
                      </label>
                    </div>

                    {/* 2. チケット使用可能期間 */}
                    <div style={{ paddingBottom: '12px', borderBottom: '1px dashed var(--card-border)' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '4px 12px', marginBottom: '8px' }}>
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
                      {!showAdvancedTiming ? (
                        row.isTicketUseEnabled && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {formatJstShort(row.ticketUseStartsAt)} 〜 {formatJstShort(row.ticketUseEndsAt)}
                          </div>
                        )
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>

                    {/* 3. 当日券発行期間 */}
                    <div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '4px 12px', marginBottom: '8px' }}>
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
                      {!showAdvancedTiming ? (
                        row.isWalkinEnabled && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            {formatJstShort(row.walkinStartsAt)} 〜 {formatJstShort(row.walkinEndsAt)}
                            {row.walkinLimit && `　上限${row.walkinLimit}枚`}
                          </div>
                        )
                      ) : (
                        <>
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
                        </>
                      )}

                      {/* Config warning message */}
                      {row.isWalkinEnabled && row.isReservationEnabled && row.walkinStartsAt && reservationEndsAt && (row.walkinStartsAt < reservationEndsAt) && (
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
                          <TriangleAlert size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
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
                      <label className="form-label" style={{ fontSize: '0.75rem' }}>予約枠（うち事前予約できる人数）</label>
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

                  {/* Row 5: 複製・削除ボタン */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '12px' }}>
                    <button
                      type="button"
                      onClick={() => duplicateSlotRow(row.id)}
                      disabled={saving}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--color-primary-border)',
                        color: 'var(--color-primary)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 16px',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.5 : 1,
                        fontSize: '0.85rem',
                      }}
                    >
                      <Copy size={14} aria-hidden="true" />この枠を複製
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicateSlotToNextDay(row.id)}
                      disabled={saving || !row.date}
                      title={row.date ? '' : '開催日を入れると使えます'}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--color-primary-border)',
                        color: 'var(--color-primary)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 16px',
                        cursor: saving || !row.date ? 'not-allowed' : 'pointer',
                        opacity: saving || !row.date ? 0.5 : 1,
                        fontSize: '0.85rem',
                      }}
                    >
                      <CalendarPlus size={14} aria-hidden="true" />翌日に複製
                    </button>
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
                      <Trash2 size={14} aria-hidden="true" />この枠を削除
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

                <div className="form-group" style={{ marginLeft: '24px', maxWidth: 220 }}>
                  <label className="form-label" htmlFor="ticketRevealMinutes">使用後にチケットコードを表示する時間（分）</label>
                  <input
                    id="ticketRevealMinutes"
                    type="number"
                    className="form-input"
                    min={1}
                    max={60}
                    value={ticketRevealMinutes}
                    onChange={(e) => setTicketRevealMinutes(e.target.value)}
                    disabled={saving}
                  />
                  <span className="form-hint">「使用する」を押した後、この時間が過ぎるとチケットコードが非表示になります（1〜60分）。</span>
                </div>

                <div style={{ marginLeft: '24px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid rgba(99, 102, 241, 0.15)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  チケットの使用可能時間は、各開催枠の「チケット使用可能期間」「当日券発行期間」で設定してください（開催時刻から自動で入ります）。
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

          {/* Section: Payment */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              5. 支払い（委員会室での受け取り）
            </h3>
            <PaymentVisitSettings
              paymentRequired={paymentRequired}
              onPaymentRequiredChange={setPaymentRequired}
              visitRequired={paymentVisitRequired}
              onVisitRequiredChange={setPaymentVisitRequired}
              windowDays={paymentVisitWindowDays}
              onWindowDaysChange={setPaymentVisitWindowDays}
              disabled={saving}
            />
          </div>

          <div className="form-hint" style={{ marginBottom: '24px', padding: '10px 14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--card-border)' }}>
            券種（ドリンク選択など）と予約時アンケートは、作成後に開く編集画面で設定できます。
          </div>

          {/* Section: Status */}
          <div className="glass-card" style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              6. 公開設定
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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

              <OptionalSection
                label="決まった日時に自動で停止・非公開にする"
                hint="一時停止のボタンは、作成後の編集画面にあります。"
                checked={useAutoStop}
                onChange={setUseAutoStop}
                disabled={saving}
              >
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                  <div>
                    <label className="form-label" htmlFor="autoSuspendAt">自動停止日時（予約・当日券・チケット使用を停止）</label>
                    <input
                      id="autoSuspendAt"
                      type="datetime-local"
                      className="form-input"
                      value={autoSuspendAt}
                      onChange={(e) => setAutoSuspendAt(e.target.value)}
                      disabled={saving}
                    />
                    <span className="form-hint">空欄なら自動停止しません。</span>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="autoHideAt">自動非公開日時（一覧から消す）</label>
                    <input
                      id="autoHideAt"
                      type="datetime-local"
                      className="form-input"
                      value={autoHideAt}
                      onChange={(e) => setAutoHideAt(e.target.value)}
                      disabled={saving}
                    />
                    <span className="form-hint">空欄なら自動で非公開にしません。</span>
                  </div>
                </div>
              </OptionalSection>
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <Link href="/admin/events" className="btn btn-secondary" style={{ flex: 1 }} aria-disabled={saving} tabIndex={saving ? -1 : undefined}>
              キャンセル
            </Link>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
              {saving ? '保存中...' : '企画を作成する'}
            </button>
          </div>
        </form>
      </div>
      </div>
      </div>

      {/* Preview Modal */}
      <EventPreviewModal
        isOpen={showPreview}
        onClose={() => setShowPreview(false)}
        formData={{
          title,
          description,
          slotRows: slotRows.map(row => ({
            id: row.id,
            label: row.label,
            date: row.date,
            startTime: row.startTime,
            endTime: row.endTime,
            capacity: row.capacity,
            totalCapacity: row.totalCapacity,
            isEnabled: true,
            isReservationEnabled: row.isReservationEnabled,
            isWalkinEnabled: row.isWalkinEnabled,
            isTicketUseEnabled: row.isTicketUseEnabled,
            reservationStartsAt,
            reservationEndsAt,
            walkinStartsAt: row.walkinStartsAt,
            walkinEndsAt: row.walkinEndsAt,
            ticketUseStartsAt: row.ticketUseStartsAt,
            ticketUseEndsAt: row.ticketUseEndsAt,
          })),
          postReservationNotes: postReservationNotes,
        }}
      />
    </div>
  );
}
