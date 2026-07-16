'use client';

export const runtime = 'edge';


import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import EventPreviewModal from '@/components/EventPreviewModal';
import { supabase } from '@/lib/supabase';

function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return true; // Empty is valid since it is optional
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Convert ISO timestamptz from DB to localized string for datetime-local input
function formatIsoToLocalString(isoStr: string | null): string {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const pad = (num: number) => num.toString().padStart(2, '0');
  
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
}

// Extract date part (YYYY-MM-DD) from ISO string
function extractDate(isoStr: string | null): string {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Extract time part (HH:mm) from ISO string
function extractTime(isoStr: string | null): string {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function AdminEditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useAdminAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backup states
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupIncludeReservations, setBackupIncludeReservations] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);

  // Preview state
  const [showPreview, setShowPreview] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  
  // Date/Time strings (empty string represents null)
  const [reservationStartsAt, setReservationStartsAt] = useState('');
  const [reservationEndsAt, setReservationEndsAt] = useState('');
  const [useStartsAt, setUseStartsAt] = useState('');
  const [useEndsAt, setUseEndsAt] = useState('');

  // Slot states
  const [slotSelectionMode, setSlotSelectionMode] = useState<'single' | 'multiple'>('single');
  interface SlotFormRow {
    id: string; // database UUID or client temp randomUUID
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
    isEnabled: boolean;
    isNew?: boolean;
  }
  const [slotRows, setSlotRows] = useState<SlotFormRow[]>([]);
  const [initialSlotIds, setInitialSlotIds] = useState<string[]>([]);
  const [slotReservationCounts, setSlotReservationCounts] = useState<Record<string, number>>({});

  // Toggles
  const [isPublic, setIsPublic] = useState(false);
  const [reservationEnabled, setReservationEnabled] = useState(true);
  const [ticketEnabled, setTicketEnabled] = useState(false);
  const [useButtonEnabled, setUseButtonEnabled] = useState(false);

  // Allowed domains
  const [allowedDomains, setAllowedDomains] = useState('');

  // Survey settings
  const [surveyAfterReservationEnabled, setSurveyAfterReservationEnabled] = useState(false);
  const [surveyAfterReservationUrl, setSurveyAfterReservationUrl] = useState('');
  const [surveyAfterReservationMessage, setSurveyAfterReservationMessage] = useState('');

  const [surveyAfterUseEnabled, setSurveyAfterUseEnabled] = useState(false);
  const [surveyAfterUseUrl, setSurveyAfterUseUrl] = useState('');
  const [surveyAfterUseMessage, setSurveyAfterUseMessage] = useState('');

  // New features
  const [isReservationSuspended, setIsReservationSuspended] = useState(false);
  const [isWalkinSuspended, setIsWalkinSuspended] = useState(false);
  const [isTicketUseSuspended, setIsTicketUseSuspended] = useState(false);
  const [autoSuspendAt, setAutoSuspendAt] = useState('');
  const [autoHideAt, setAutoHideAt] = useState('');
  const [postReservationNotes, setPostReservationNotes] = useState('');
  const [lowRemainingThreshold, setLowRemainingThreshold] = useState('10');
  const [lowRemainingThresholdType, setLowRemainingThresholdType] = useState<'count' | 'percent'>('count');

  useEffect(() => {
    async function loadEvent() {
      try {
        const { data, error: loadError } = await supabase
          .from('events')
          .select('*')
          .eq('id', id)
          .single();

        if (loadError || !data) {
          setError('企画が見つからないか、エラーが発生しました。');
          setLoading(false);
          return;
        }

        // Prepopulate states
        setTitle(data.title || '');
        setDescription(data.description || '');
        setReservationStartsAt(formatIsoToLocalString(data.reservation_starts_at));
        setReservationEndsAt(formatIsoToLocalString(data.reservation_ends_at));
        setUseStartsAt(formatIsoToLocalString(data.use_starts_at));
        setUseEndsAt(formatIsoToLocalString(data.use_ends_at));
        setIsPublic(data.is_public ?? false);
        setReservationEnabled(data.reservation_enabled ?? true);
        setTicketEnabled(data.ticket_enabled ?? false);
        setUseButtonEnabled(data.use_button_enabled ?? false);
        setAllowedDomains(Array.isArray(data.allowed_email_domains) ? data.allowed_email_domains.join(', ') : 'ge.osaka-sandai.ac.jp');
        setSlotSelectionMode(data.slot_selection_mode === 'multiple' ? 'multiple' : 'single');
        
        setSurveyAfterReservationEnabled(data.survey_after_reservation_enabled ?? false);
        setSurveyAfterReservationUrl(data.survey_after_reservation_url || '');
        setSurveyAfterReservationMessage(data.survey_after_reservation_message || '今後の企画改善のため、アンケートにご協力ください。');

        setSurveyAfterReservationMessage(data.survey_after_reservation_message || '今後の企画改善のため、アンケートにご協力ください。');

        setSurveyAfterUseEnabled(data.survey_after_use_enabled ?? false);
        setSurveyAfterUseUrl(data.survey_after_use_url || '');
        setSurveyAfterUseMessage(data.survey_after_use_message || 'ご参加ありがとうございました。今後の企画改善のため、アンケートにご協力ください。');

        setIsReservationSuspended(data.is_reservation_suspended ?? false);
        setIsWalkinSuspended(data.is_walkin_suspended ?? false);
        setIsTicketUseSuspended(data.is_ticket_use_suspended ?? false);
        setAutoSuspendAt(formatIsoToLocalString(data.auto_suspend_at));
        setAutoHideAt(formatIsoToLocalString(data.auto_hide_at));
        setPostReservationNotes(data.post_reservation_notes || '');
        setLowRemainingThreshold(data.low_remaining_threshold?.toString() || '10');
        setLowRemainingThresholdType(data.low_remaining_threshold_type === 'percent' ? 'percent' : 'count');

        // Fetch slots
        const { data: slotsData, error: slotsError } = await supabase
          .from('event_slots')
          .select('*')
          .eq('event_id', id)
          .order('sort_order', { ascending: true });

        if (!slotsError && slotsData) {
          const loadedRows: SlotFormRow[] = slotsData.map((s) => ({
            id: s.id,
            label: s.label,
            date: extractDate(s.starts_at),
            startTime: extractTime(s.starts_at),
            endTime: extractTime(s.ends_at),
            reservationStartsAt: formatIsoToLocalString(s.reservation_starts_at || data.reservation_starts_at),
            reservationEndsAt: formatIsoToLocalString(s.reservation_ends_at || data.reservation_ends_at),
            ticketUseStartsAt: formatIsoToLocalString(s.ticket_use_starts_at || s.reservation_use_starts_at || data.use_starts_at || s.starts_at),
            ticketUseEndsAt: formatIsoToLocalString(s.ticket_use_ends_at || s.reservation_use_ends_at || data.use_ends_at || s.ends_at),
            walkinStartsAt: formatIsoToLocalString(s.walkin_starts_at || s.walkin_use_starts_at || s.starts_at),
            walkinEndsAt: formatIsoToLocalString(s.walkin_ends_at || s.walkin_use_ends_at || s.ends_at),
            isReservationEnabled: s.is_reservation_enabled ?? s.is_enabled ?? true,
            isTicketUseEnabled: s.is_ticket_use_enabled ?? data.use_button_enabled ?? true,
            isWalkinEnabled: s.is_walkin_enabled ?? s.is_enabled ?? true,
            walkinLimit: s.walkin_limit !== null && s.walkin_limit !== undefined ? s.walkin_limit.toString() : '',
            capacity: s.reservation_capacity ?? s.capacity ?? 50,
            totalCapacity: s.total_capacity ?? s.capacity ?? s.reservation_capacity ?? 50,
            isEnabled: s.is_enabled ?? true,
          }));
          setSlotRows(loadedRows);
          setInitialSlotIds(slotsData.map((s) => s.id));
        }

        // Fetch reservations to calculate active booking counts per slot (only active, capacity-consuming statuses)
        const { data: resData, error: resError } = await supabase
          .from('reservations')
          .select('event_slot_id')
          .eq('event_id', id)
          .in('status', ['reserved', 'used']);

        if (!resError && resData) {
          const counts: Record<string, number> = {};
          resData.forEach((r) => {
            if (r.event_slot_id) {
              counts[r.event_slot_id] = (counts[r.event_slot_id] || 0) + 1;
            }
          });
          setSlotReservationCounts(counts);
        }

      } catch (err) {
        console.error('Failed to load event details:', err);
        setError('データの取得に失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    if (!authLoading && user) {
      loadEvent();
    }
  }, [id, authLoading, user]);

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
      totalCapacity: 50,
      isEnabled: true,
      isNew: true
    }]);
  };

  const removeSlotRow = (slotId: string) => {
    const reservationCount = slotReservationCounts[slotId] || 0;
    if (reservationCount > 0) {
      alert('この枠には既に予約が入っているため削除できません。');
      return;
    }
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
        isNew: true
      };
      const newRows = [...prev];
      newRows.splice(rowIndex + 1, 0, newRow);
      return newRows;
    });
  };

  const handleDelete = async () => {
    if (!window.confirm('企画を完全に削除しますか？\n（危険：この操作は実行すると取り消せません）')) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      // 1. Check reservation count in real-time
      const { count, error: countError } = await supabase
        .from('reservations')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', id);

      if (countError) {
        throw new Error(`段階「予約データの存在確認」で失敗しました: ${countError.message}`);
      }

      const hasReservations = count !== null && count > 0;
      let confirmed = false;

      if (!hasReservations) {
        confirmed = window.confirm('この企画を完全に削除しますか？この操作は取り消せません。');
      } else {
        const input = window.prompt(
          `この企画には予約データがあります。削除すると予約者情報、チケット、使用履歴もすべて削除されます。本当に完全削除しますか？この操作は取り消せません。\n\n誤操作防止のため、確認として「完全削除」と入力してください。`
        );
        confirmed = input === '完全削除';
      }

      if (!confirmed) {
        setDeleting(false);
        return;
      }

      // 2. Execute RPC deletion
      const { error: deleteError } = await supabase.rpc('delete_event_admin', {
        p_event_id: id
      });

      if (deleteError) {
        throw new Error(`段階「管理者RPCによるデータ削除（reservations -> event_slots -> events）」で失敗しました: ${deleteError.message}`);
      }

      alert('企画が正常に完全削除されました。');
      router.push('/admin/events');

    } catch (err: any) {
      console.error('Event delete failed:', err);
      setError(err.message || '企画の削除中に予期しないエラーが発生しました。');
      alert(err.message || '企画の削除中に予期しないエラーが発生しました。');
      setDeleting(false);
    }
  };

  const handleExportBackup = async () => {
    setExportingBackup(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_export_event_backup', {
        p_event_id: id,
        p_include_reservations: backupIncludeReservations
      });
      
      if (rpcError) throw new Error(rpcError.message);
      
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${title || 'event'}_${backupIncludeReservations ? 'full' : 'config'}_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setShowBackupModal(false);
    } catch (err: any) {
      console.error('Backup export failed:', err);
      setError('バックアップの取得に失敗しました: ' + (err.message || '不明なエラー'));
    } finally {
      setExportingBackup(false);
    }
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

    // Slot validation
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

    const parseToIso = (dtStr: string): string | null => {
      if (!dtStr) return null;
      return new Date(dtStr).toISOString();
    };

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
      is_reservation_suspended: isReservationSuspended,
      is_walkin_suspended: isWalkinSuspended,
      is_ticket_use_suspended: isTicketUseSuspended,
      auto_suspend_at: autoSuspendAt ? new Date(autoSuspendAt).toISOString() : null,
      auto_hide_at: autoHideAt ? new Date(autoHideAt).toISOString() : null,
      post_reservation_notes: postReservationNotes.trim() || null,
      low_remaining_threshold: parseInt(lowRemainingThreshold) || 10,
      low_remaining_threshold_type: lowRemainingThresholdType,
      updated_at: new Date().toISOString()
    };

    try {
      const { error: updateError } = await supabase
        .from('events')
        .update(eventData)
        .eq('id', id);

      if (updateError) {
        setError(updateError.message || '企画の更新に失敗しました。');
        setSaving(false);
        return;
      }

      // 1. Delete removed slots
      const currentSlotIds = slotRows.map((r) => r.id);
      const removedSlotIds = initialSlotIds.filter((id) => !currentSlotIds.includes(id));
      if (removedSlotIds.length > 0) {
        const { error: deleteError } = await supabase
          .from('event_slots')
          .delete()
          .in('id', removedSlotIds);
        if (deleteError) {
          console.error('event_slots delete error:', deleteError);
          setError(`開催枠の削除に失敗しました: ${deleteError.message}`);
          setSaving(false);
          return;
        }
      }

      // 2. Separate into insert and update calls
      for (const row of slotRows) {
        const isNew = !initialSlotIds.includes(row.id) || row.isNew;
        const payload = {
          event_id: id,
          label: row.label.trim(),
          starts_at: combineDateTime(row.date, row.startTime),
          ends_at: combineDateTime(row.date, row.endTime),
          reservation_capacity: Number(row.capacity),
          total_capacity: Number(row.totalCapacity),
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
          is_enabled: row.isEnabled ?? true,
          sort_order: slotRows.indexOf(row),
        };

        if (isNew) {
          // INSERT new slot
          const { error: insertError } = await supabase
            .from('event_slots')
            .insert([payload]);
          if (insertError) {
            console.error('event_slots insert error:', insertError);
            setError(`開催枠「${row.label || '無題の枠'}」の新規作成に失敗しました: ${insertError.message}`);
            setSaving(false);
            return;
          }
        } else {
          // UPDATE existing slot
          const { error: updateSlotError } = await supabase
            .from('event_slots')
            .update(payload)
            .eq('id', row.id);
          if (updateSlotError) {
            console.error('event_slots update error:', updateSlotError);
            setError(`開催枠「${row.label || '無題の枠'}」の更新に失敗しました: ${updateSlotError.message}`);
            setSaving(false);
            return;
          }
        }
      }

      // Success: Redirect to dashboard
      router.push('/admin/events');
    } catch (err) {
      console.error('Error updating event:', err);
      setError('サーバー処理中にエラーが発生しました。');
      setSaving(false);
    }
  };

  if (authLoading || loading) {
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
            企画設定の編集
          </h1>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              onClick={() => setShowPreview(true)}
            >
              👁 プレビュー
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '8px 16px', fontSize: '0.85rem' }}
              onClick={() => setShowBackupModal(true)}
            >
              💾 バックアップ出力
            </button>
          </div>
        </div>

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
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }} onClick={() => {
                  const el = document.getElementById('description') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '重要なテキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setDescription(`${before}[red:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 5, start + 5 + selectedText.length); }, 0);
                }}>赤字(重要)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }} onClick={() => {
                  const el = document.getElementById('description') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '注意テキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setDescription(`${before}[orange:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 8, start + 8 + selectedText.length); }, 0);
                }}>オレンジ(注意)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }} onClick={() => {
                  const el = document.getElementById('description') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '補足テキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setDescription(`${before}[blue:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 6, start + 6 + selectedText.length); }, 0);
                }}>青字(補足)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-success)', borderColor: 'var(--color-success)' }} onClick={() => {
                  const el = document.getElementById('description') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '案内テキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setDescription(`${before}[green:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 7, start + 7 + selectedText.length); }, 0);
                }}>緑字(案内)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'var(--bg-secondary)', borderColor: 'var(--card-border)' }} onClick={() => {
                  const el = document.getElementById('description') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '注意書きブロック内容';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setDescription(`${before}[alert:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 7, start + 7 + selectedText.length); }, 0);
                }}>注意書きブロック</button>
              </div>
              <textarea
                id="description"
                className="form-input"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
              <span className="form-hint">文字を太字にしたり、リンクを貼ったりできます。</span>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="postReservationNotes">予約完了後の注意事項（利用者のチケット画面上部に表示）</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-danger)', borderColor: 'var(--color-danger)' }} onClick={() => {
                  const el = document.getElementById('postReservationNotes') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '重要なテキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setPostReservationNotes(`${before}[red:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 5, start + 5 + selectedText.length); }, 0);
                }}>赤字(重要)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }} onClick={() => {
                  const el = document.getElementById('postReservationNotes') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '注意テキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setPostReservationNotes(`${before}[orange:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 8, start + 8 + selectedText.length); }, 0);
                }}>オレンジ(注意)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-primary)', borderColor: 'var(--color-primary)' }} onClick={() => {
                  const el = document.getElementById('postReservationNotes') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '補足テキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setPostReservationNotes(`${before}[blue:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 6, start + 6 + selectedText.length); }, 0);
                }}>青字(補足)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--color-success)', borderColor: 'var(--color-success)' }} onClick={() => {
                  const el = document.getElementById('postReservationNotes') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '案内テキスト';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setPostReservationNotes(`${before}[green:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 7, start + 7 + selectedText.length); }, 0);
                }}>緑字(案内)</button>
                <button type="button" className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.8rem', background: 'var(--bg-secondary)', borderColor: 'var(--card-border)' }} onClick={() => {
                  const el = document.getElementById('postReservationNotes') as HTMLTextAreaElement;
                  if (!el) return;
                  const start = el.selectionStart;
                  const end = el.selectionEnd;
                  const text = el.value;
                  const selectedText = text.substring(start, end) || '注意書きブロック内容';
                  const before = text.substring(0, start);
                  const after = text.substring(end);
                  setPostReservationNotes(`${before}[alert:${selectedText}]${after}`);
                  setTimeout(() => { el.focus(); el.setSelectionRange(start + 7, start + 7 + selectedText.length); }, 0);
                }}>注意書きブロック</button>
              </div>
              <textarea
                id="postReservationNotes"
                className="form-input"
                rows={3}
                placeholder="例：当日は学生証を必ず持参してください。10分前には集合してください。"
                value={postReservationNotes}
                onChange={(e) => setPostReservationNotes(e.target.value)}
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

            {/* Remaining Threshold Setting */}
            <div className="form-group" style={{ marginTop: '16px', background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <label className="form-label" style={{ marginBottom: '8px' }}>「残りわずか」表示の基準（利用者画面の表示）</label>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <input
                  type="number"
                  className="form-input"
                  style={{ width: '120px' }}
                  min="0"
                  value={lowRemainingThreshold}
                  onChange={(e) => setLowRemainingThreshold(e.target.value)}
                  disabled={saving}
                />
                <select
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
                ※ 残数がこの基準を下回った場合、予約画面で具体的な人数ではなく「残りわずか」と表示されます。<br/>
                ※ 基準値以上残っている場合は「余裕あり」、定員に達した場合は「満席」と表示されます。
              </span>
            </div>

            {/* Slot management */}
            <div style={{ marginTop: '20px', background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', color: 'var(--text-primary)' }}>開催枠の管理</h4>
              <span className="form-hint" style={{ display: 'block', marginBottom: '12px' }}>各開催枠に、枠名・開催日時・定員を設定できます。少なくとも1つの枠が必要です。</span>

              {slotRows.map((row) => {
                const resCount = slotReservationCounts[row.id] || 0;
                const hasReservations = resCount > 0;

                return (
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

                    {/* Row 3.5: Timings & Limits Configuration */}
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
                          取得済みの予約券および当日券を「使用する（引き換え）」ことができる時間帯です。
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
                          この開催枠で当日券の発行を受け付ける期間と上限数を設定します。
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

                        {/* Config warning */}
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

                    {/* Row 5: 複製・削除ボタン */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
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
                        📄 この枠を複製
                      </button>
                      <button
                        type="button"
                        onClick={() => removeSlotRow(row.id)}
                        disabled={saving || slotRows.length <= 1 || hasReservations}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--color-danger-border)',
                          color: 'var(--color-danger)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '8px 16px',
                          cursor: (slotRows.length <= 1 || hasReservations) ? 'not-allowed' : 'pointer',
                          opacity: (slotRows.length <= 1 || hasReservations) ? 0.3 : 1,
                          fontSize: '0.85rem',
                        }}
                        title={hasReservations ? `予約あり (${resCount}件) のため削除不可` : ''}
                      >
                        {hasReservations ? '予約あり' : '🗑 この枠を削除'}
                      </button>
                    </div>
                  </div>
                );
              })}

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
              5. 公開・停止設定
            </h3>
            
            <div className="glass-card" style={{ padding: '16px', marginBottom: '16px' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--text-primary)' }}>基本公開設定</h4>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
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

            <div className="glass-card" style={{ padding: '16px', marginBottom: '16px', border: '1px solid var(--color-warning-border)', background: 'rgba(245, 158, 11, 0.05)' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--color-warning)' }}>手動一時停止（緊急用）</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                トラブル時などに、設定された受付期間に関わらず即座に機能を停止できます。
              </p>
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                <label className="form-checkbox-label" style={{ color: isReservationSuspended ? 'var(--color-danger)' : 'inherit' }}>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={isReservationSuspended}
                    onChange={(e) => setIsReservationSuspended(e.target.checked)}
                    disabled={saving}
                  />
                  通常予約の受付を一時停止
                </label>
                <label className="form-checkbox-label" style={{ color: isWalkinSuspended ? 'var(--color-danger)' : 'inherit' }}>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={isWalkinSuspended}
                    onChange={(e) => setIsWalkinSuspended(e.target.checked)}
                    disabled={saving}
                  />
                  当日券の発行を一時停止
                </label>
                <label className="form-checkbox-label" style={{ color: isTicketUseSuspended ? 'var(--color-danger)' : 'inherit' }}>
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={isTicketUseSuspended}
                    onChange={(e) => setIsTicketUseSuspended(e.target.checked)}
                    disabled={saving}
                  />
                  チケットの使用（引き換え）を一時停止
                </label>
              </div>
            </div>

            <div className="glass-card" style={{ padding: '16px' }}>
              <h4 style={{ fontSize: '1rem', marginBottom: '12px', color: 'var(--text-primary)' }}>自動停止・自動非公開（企画終了後）</h4>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                企画終了時刻に合わせて自動的にすべての機能を停止し、さらに一覧から非公開にすることができます。
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '16px' }}>
                <div className="form-group">
                  <label className="form-label" htmlFor="autoSuspendAt">自動機能停止日時（予約・当日券・使用のすべて）</label>
                  <input
                    id="autoSuspendAt"
                    type="datetime-local"
                    className="form-input"
                    value={autoSuspendAt}
                    onChange={(e) => setAutoSuspendAt(e.target.value)}
                    disabled={saving}
                  />
                  <span className="form-hint">この日時を過ぎると、一時停止状態が自動的に「オン」と同等になります。</span>
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="autoHideAt">自動非公開日時</label>
                  <input
                    id="autoHideAt"
                    type="datetime-local"
                    className="form-input"
                    value={autoHideAt}
                    onChange={(e) => setAutoHideAt(e.target.value)}
                    disabled={saving}
                  />
                  <span className="form-hint">この日時を過ぎると、一般公開が自動的に「オフ」と同等になり、一覧から消えます。</span>
                </div>
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
              {saving ? '保存中...' : '企画設定を保存'}
            </button>
          </div>
        </form>

        {/* Section: Danger Zone */}
        <div className="glass-card" style={{ marginTop: '40px', borderTop: '4px solid var(--color-danger)', background: 'rgba(244, 63, 94, 0.02)', borderColor: 'var(--color-danger-border)' }}>
          <h3 style={{ fontSize: '1.1rem', marginBottom: '8px', color: 'var(--color-danger)' }}>
            ⚠️ 危険エリア
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
            この企画を完全に削除します。企画に紐づくすべての開催枠、および予約データ（チケット・使用履歴含む）が恒久的に削除されます。この操作は取り消せません。
          </p>
          <button
            type="button"
            className="btn btn-danger"
            style={{ maxWidth: '240px' }}
            onClick={handleDelete}
            disabled={saving || deleting}
          >
            {deleting ? '削除処理中...' : '🗑️ 企画を完全に削除する'}
          </button>
        </div>
      </div>
      </div>
      </div>

      {/* Backup Modal */}
      {showBackupModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: '20px' }}
          onClick={() => setShowBackupModal(false)}
        >
          <div
            className="glass-card"
            style={{ maxWidth: '500px', width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--text-primary)' }}>
              💾 JSONバックアップの出力
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '20px' }}>
              企画の設定データをJSONファイルとしてPCにダウンロードします。Supabase Storage やデータベースには保存されません。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: !backupIncludeReservations ? 'var(--color-primary-glow)' : 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: `1px solid ${!backupIncludeReservations ? 'var(--color-primary)' : 'var(--card-border)'}`, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="backupType"
                  checked={!backupIncludeReservations}
                  onChange={() => setBackupIncludeReservations(false)}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>設定のみ</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>企画・開催枠の設定情報のみ（予約者情報は含みません）</div>
                </div>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: backupIncludeReservations ? 'var(--color-primary-glow)' : 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: `1px solid ${backupIncludeReservations ? 'var(--color-primary)' : 'var(--card-border)'}`, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="backupType"
                  checked={backupIncludeReservations}
                  onChange={() => setBackupIncludeReservations(true)}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>設定＋予約者情報</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>企画設定に加えて、全予約者の情報を含みます</div>
                </div>
              </label>
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ flex: 1 }}
                onClick={() => setShowBackupModal(false)}
                disabled={exportingBackup}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={handleExportBackup}
                disabled={exportingBackup}
              >
                {exportingBackup ? 'ダウンロード中...' : '📥 ダウンロード'}
              </button>
            </div>
          </div>
        </div>
      )}

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
            isEnabled: row.isEnabled,
            isReservationEnabled: row.isReservationEnabled,
            isWalkinEnabled: row.isWalkinEnabled,
            isTicketUseEnabled: row.isTicketUseEnabled,
            reservationStartsAt: row.reservationStartsAt,
            reservationEndsAt: row.reservationEndsAt,
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
