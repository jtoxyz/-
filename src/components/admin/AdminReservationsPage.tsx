'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BarChart3, CalendarDays, Ticket, ClipboardCopy, Download, GraduationCap, Mail, Trash2, TriangleAlert, UserRound, X } from 'lucide-react';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { adminSupabase as supabase } from '@/lib/supabase';
import { type SurveyAnswers, type SurveyQuestion, type SurveyQuestionSummary, formatSurveyAnswer, summarizeSurvey } from '@/lib/survey';
import { PAYMENT_LABEL, facultyGradeSheet, formatDateTime, reservationListSheet, summaryNote, surveyStatsSheet, totalsSheet } from '@/lib/reservationExport';
import { type XlsxSheet, downloadXlsx } from '@/lib/xlsx';
import { formatTicketOption } from '@/lib/ticketOption';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { type PaymentVisitSlot, VISIT_SLOT_COLUMNS, formatVisitSlot, visitSlotPlace } from '@/lib/paymentVisit';

interface ReservationItem {
  id: string;
  event_slot_id: string | null;
  student_name: string;
  student_number: string;
  university_email: string;
  status: 'reserved' | 'used' | 'cancelled';
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  used_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  event_slots: { label: string } | null;
  ticket_option_id?: string | null;
  event_ticket_options: { label: string; price_yen: number } | null;
  payment_visit_slot_id?: string | null;
  payment_visit_slots?: PaymentVisitSlot | null;
  survey_answers: SurveyAnswers | null;
}

interface AdminEventSlot {
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
  walkin_limit: number | null;
  ticket_use_ends_at?: string | null;
  is_walkin_enabled?: boolean;
}

interface TicketOptionRow {
  id: string;
  label: string;
  price_yen: number;
  is_enabled: boolean;
  sort_order: number;
}

type PickupFilter = { slotId: string; kind: 'used' | 'not_used' } | null;

/** 受け取り（チケット使用）の締め切り。枠の使用終了時刻、なければ枠の終了時刻 */
function pickupEndsAt(slot: AdminEventSlot | undefined): string | null {
  if (!slot) return null;
  return slot.ticket_use_ends_at || slot.ends_at;
}

function safeFileName(value: string): string {
  return value.replace(/[\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'event';
}

export default function AdminReservationsPage({ id }: { id: string }) {
  const { loading: authLoading, user } = useAdminAuth();
  const [eventTitle, setEventTitle] = useState('');
  const [reservations, setReservations] = useState<ReservationItem[]>([]);
  const [slots, setSlots] = useState<AdminEventSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [pickupFilter, setPickupFilter] = useState<PickupFilter>(null);
  // 「受け取らずに終了」の判定に使う現在時刻（1分ごとに更新）
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [showWipeModal, setShowWipeModal] = useState(false);
  const [wipeConfirmText, setWipeConfirmText] = useState('');
  const [wiping, setWiping] = useState(false);
  const [surveyQuestions, setSurveyQuestions] = useState<SurveyQuestion[]>([]);
  // 券種ごとの人数を出すための券種一覧（まだ誰も選んでいない券種も0人で出す）
  const [ticketOptions, setTicketOptions] = useState<TicketOptionRow[]>([]);
  // 支払い日時の変更に使う、まだ終わっていない有効な支払い日時
  const [visitSlots, setVisitSlots] = useState<PaymentVisitSlot[]>([]);
  const [changingVisitId, setChangingVisitId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events').select('title, survey_config').eq('id', id).single();
      setError(null);
      if (eventError || !eventData) throw new Error('企画情報が見つかりません。');
      setEventTitle(eventData.title);
      setSurveyQuestions(((eventData.survey_config as { questions?: SurveyQuestion[] } | null)?.questions) ?? []);

      const { data: resData, error: resError } = await supabase
        .from('reservations')
        .select(`*, event_slots(label), event_ticket_options(label, price_yen), payment_visit_slots(${VISIT_SLOT_COLUMNS})`)
        .eq('event_id', id)
        .order('created_at', { ascending: false });
      if (resError) throw resError;
      setReservations((resData as unknown as ReservationItem[]) || []);

      const { data: optionData, error: optionError } = await supabase
        .from('event_ticket_options')
        .select('id, label, price_yen, is_enabled, sort_order')
        .eq('event_id', id)
        .order('sort_order', { ascending: true });
      if (optionError) console.error(optionError);
      setTicketOptions((optionData as TicketOptionRow[]) || []);

      const { data: slotsData, error: slotsError } = await supabase.rpc('get_event_slots', { p_event_id: id });
      if (slotsError) throw slotsError;
      setSlots((slotsData as AdminEventSlot[]) || []);

      const { data: visitData, error: visitError } = await supabase
        .from('payment_visit_slots')
        .select(VISIT_SLOT_COLUMNS)
        .eq('is_active', true)
        .gt('ends_at', new Date().toISOString())
        .order('starts_at', { ascending: true });
      if (visitError) console.error(visitError);
      setVisitSlots((visitData as PaymentVisitSlot[]) || []);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'データの読み込みに失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useLoadEffect(() => {
    if (!authLoading && user) return loadData();
  }, [authLoading, user, loadData]);

  // 一覧の列（氏名・学籍番号）を1行ずつコピーする。キャンセルを除き、今の絞り込み・検索に合わせる
  const copyColumn = async (rows: ReservationItem[], pick: (row: ReservationItem) => string, label: string) => {
    const values = rows.filter((row) => row.status !== 'cancelled').map(pick).filter(Boolean);
    if (values.length === 0) {
      alert(`コピーできる${label}がありません。`);
      return;
    }
    try {
      await navigator.clipboard.writeText(values.join('\n'));
      alert(`${values.length}件の${label}をコピーしました。`);
    } catch (copyError) {
      console.error(copyError);
      setError(`${label}のコピーに失敗しました。`);
    }
  };

  // メールアドレスをカンマ区切りでコピーする（Gmail の宛先欄にそのまま貼り付けられる形）
  const copyEmailList = async (rows: ReservationItem[], label: string) => {
    const emails = Array.from(new Set(
      rows.map((res) => res.university_email?.trim()).filter((email): email is string => Boolean(email)),
    ));
    if (emails.length === 0) {
      alert(`${label}にコピーできるメールアドレスがありません。`);
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(','));
      alert(`${label}の${emails.length}件のメールアドレスをコピーしました。GmailのBcc欄にそのまま貼り付けられます（宛先欄に貼ると、受け取った全員にほかの人のアドレスが見えます）。`);
    } catch (copyError) {
      console.error(copyError);
      setError('メールアドレスのコピーに失敗しました。');
    }
  };

  const handleCopyEmails = async (includeUsed: boolean) => {
    const emails = Array.from(new Set(
      reservations
        .filter((res) => res.status !== 'cancelled' && (includeUsed || res.status === 'reserved'))
        .map((res) => res.university_email?.trim())
        .filter((email): email is string => Boolean(email)),
    ));
    if (emails.length === 0) {
      alert(includeUsed ? 'コピーできる予約者メールがありません。' : '未使用の予約者メールがありません。');
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(','));
      alert(`${emails.length}件のメールアドレスをコピーしました。`);
    } catch (copyError) {
      console.error(copyError);
      setError('メールアドレスのコピーに失敗しました。');
    }
  };

  const handleCancelReservation = async (reservationId: string) => {
    if (!confirm('本当にこの予約をキャンセルしますか？')) return;
    setCancellingId(reservationId);
    const { error: cancelError } = await supabase
      .from('reservations')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', reservationId);
    if (cancelError) setError(cancelError.message);
    else await loadData();
    setCancellingId(null);
  };

  // 未払いの予約の「支払いに来る日時」を変更する（支払い期限も新しい日時の終了時刻になる）
  const handleChangeVisitSlot = async (res: ReservationItem, slotId: string) => {
    if (!slotId || slotId === res.payment_visit_slot_id) return;
    const next = visitSlots.find((slot) => slot.id === slotId);
    if (!next) return;
    if (!confirm(`${res.student_name}さんの支払い日時を「${formatVisitSlot(next)}」に変更しますか？`)) return;
    setChangingVisitId(res.id);
    const { error: changeError } = await supabase.rpc('admin_change_payment_visit_slot', {
      p_reservation_id: res.id,
      p_payment_visit_slot_id: slotId,
    });
    if (changeError) setError(changeError.message);
    else await loadData();
    setChangingVisitId(null);
  };

  const closeWipeModal = () => {
    setShowWipeModal(false);
    setWipeConfirmText('');
  };

  const handleWipeData = async () => {
    if (wipeConfirmText !== '完全削除') return;
    setWiping(true);
    const { error: wipeError } = await supabase.from('reservations').delete().eq('event_id', id);
    if (wipeError) setError(wipeError.message);
    else {
      setReservations([]);
      closeWipeModal();
      alert('すべての予約データを削除しました。');
    }
    setWiping(false);
  };

  // 予約者一覧・集計・学部と学年・アンケート統計を1つの .xlsx にまとめる（アンケートは個別の回答ではなく統計で出す）
  const handleExportExcel = () => {
    if (reservations.length === 0) return alert('エクスポートする予約データがありません。');
    const sheets: XlsxSheet[] = [
      reservationListSheet(reservations, slots), totalsSheet(eventTitle, reservations, slots), facultyGradeSheet(reservations),
    ];
    if (surveyQuestions.length > 0) sheets.push(surveyStatsSheet(surveyQuestions, surveySummary, activeSurveyAnswers));
    const date = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
    downloadXlsx(sheets, `reservations_${safeFileName(eventTitle)}_${date}.xlsx`);
  };

  const slotById = new Map(slots.map((slot) => [slot.id, slot]));
  const pickupClosed = (slotId: string | null) => {
    const end = pickupEndsAt(slotId ? slotById.get(slotId) : undefined);
    return Boolean(end && new Date(end).getTime() < nowMs);
  };

  // アンケート集計はキャンセルを除いた予約で数える
  const activeSurveyAnswers = reservations.filter((r) => r.status !== 'cancelled').map((r) => r.survey_answers);
  const surveySummary = summarizeSurvey(surveyQuestions, activeSurveyAnswers);

  const filteredReservations = reservations.filter((res) => {
    if (pickupFilter) {
      if (res.event_slot_id !== pickupFilter.slotId) return false;
      if (pickupFilter.kind === 'used' && res.status !== 'used') return false;
      if (pickupFilter.kind === 'not_used' && res.status !== 'reserved') return false;
    }
    const query = searchQuery.trim().toLowerCase();
    return !query || res.student_name.toLowerCase().includes(query) || res.student_number.toLowerCase().includes(query);
  });

  const showPickupList = (slotId: string, kind: 'used' | 'not_used') => {
    setPickupFilter({ slotId, kind });
    setTimeout(() => document.getElementById('reservation-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  if (authLoading || loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0' }}><div className="loading-spinner" /></div>;
  }

  const activeBookings = reservations.filter((r) => r.status === 'reserved' || r.status === 'used').length;
  const unusedTickets = reservations.filter((r) => r.status === 'reserved').length;
  const usedTickets = reservations.filter((r) => r.status === 'used').length;
  const cancelledBookings = reservations.filter((r) => r.status === 'cancelled').length;
  const activeRows = reservations.filter((r) => r.status === 'reserved' || r.status === 'used');
  // 受け取り日（枠の開始日）ごとの有効な予約者。当日の案内メールをまとめて送るため
  const slotDays = (() => {
    const dayOf = (value: string | null) => (value ? new Date(value).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }) : null);
    const days = new Map<string, { key: string; label: string; slotIds: Set<string> }>();
    for (const slot of slots) {
      const key = dayOf(slot.starts_at);
      if (!key) continue;
      const entry = days.get(key) || {
        key,
        label: new Date(`${key}T12:00:00+09:00`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }),
        slotIds: new Set<string>(),
      };
      entry.slotIds.add(slot.id);
      days.set(key, entry);
    }
    return [...days.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((day) => ({ key: day.key, label: day.label, rows: activeRows.filter((r) => r.event_slot_id && day.slotIds.has(r.event_slot_id)) }));
  })();
  const paymentRequired = reservations.some((r) => r.payment_status && r.payment_status !== 'not_required');
  const paidBookings = activeRows.filter((r) => r.payment_status === 'paid').length;
  const unpaidBookings = activeRows.filter((r) => r.payment_status === 'pending').length;
  const noShowCancelled = reservations.filter((r) => r.status === 'cancelled' && r.payment_status === 'expired').length;
  const statCard = (label: string, value: number, note: string) => (
    <div className="glass-card" style={{ margin: 0 }}><small>{label}</small><div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div><small>{note}</small></div>
  );

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <div>
          <div style={{ marginBottom: 20 }}><Link href="/admin/events">← 企画一覧に戻る</Link></div>

          <div className="glass-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div><h1>予約者一覧</h1><p>{eventTitle}</p></div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <input className="form-input" type="search" aria-label="氏名・学籍番号で検索" placeholder="氏名・学籍番号で検索..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                <button type="button" onClick={handleExportExcel} className="btn btn-secondary"><Download size={17} aria-hidden="true" />Excelでダウンロード</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 12, marginTop: 20 }}>
              {statCard('予約人数', activeBookings, 'キャンセルを除く')}
              {paymentRequired ? (
                <>
                  {statCard('支払い済み', paidBookings, '予約人数のうち')}
                  {statCard('未払い', unpaidBookings, '予約人数のうち')}
                </>
              ) : (
                statCard('未使用', unusedTickets, 'これから使用可能')
              )}
              {statCard('キャンセル', cancelledBookings, paymentRequired ? `うち支払いに来なかった ${noShowCancelled}` : '予約人数には含まない')}
              {statCard('受け取り済み', usedTickets, 'チケット使用済み')}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCopyEmails(false)}><Mail size={15} aria-hidden="true" />未使用者メールをコピー</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCopyEmails(true)}><Mail size={15} aria-hidden="true" />予約者全員のメールをコピー</button>
              {paymentRequired && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyEmailList(activeRows.filter((r) => r.payment_status === 'pending'), '未払いの予約者')} disabled={unpaidBookings === 0}>
                  <Mail size={15} aria-hidden="true" />未払いの人のメールをコピー（{unpaidBookings}件）
                </button>
              )}
              {slotDays.map(({ key, label, rows }) => (
                <button type="button" key={key} className="btn btn-secondary btn-sm" onClick={() => void copyEmailList(rows, `${label}の予約者`)} disabled={rows.length === 0}>
                  <Mail size={15} aria-hidden="true" />{label}の予約者メールをコピー（{rows.length}件）
                </button>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyColumn(filteredReservations, (r) => r.student_name, '氏名')}><UserRound size={15} aria-hidden="true" />表示中の氏名をコピー</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyColumn(filteredReservations, (r) => r.student_number, '学籍番号')}><GraduationCap size={15} aria-hidden="true" />表示中の学籍番号をコピー</button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => setShowWipeModal(true)} style={{ marginLeft: 'auto' }}><Trash2 size={15} aria-hidden="true" />予約データの完全削除</button>
            </div>
          </div>

          {error && <div className="error-banner" role="alert"><TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} /><span>{error}</span></div>}

          {slots.length > 0 && (() => {
            const rows = slots.map((slot) => {
              const slotRows = reservations.filter((r) => r.event_slot_id === slot.id);
              const active = slotRows.filter((r) => r.status !== 'cancelled');
              const reservationIssued = active.filter((r) => r.ticket_type === 'reservation').length;
              const walkinIssued = active.filter((r) => r.ticket_type === 'walkin').length;
              const held = Math.max(slot.reserved_count - reservationIssued, 0) + Math.max(slot.walkin_count - walkinIssued, 0);
              return {
                slot,
                active,
                reservationIssued,
                walkinIssued,
                held,
                occupied: reservationIssued + walkinIssued + held,
                used: slotRows.filter((r) => r.status === 'used').length,
                notUsed: slotRows.filter((r) => r.status === 'reserved').length,
                closed: pickupClosed(slot.id),
                showWalkin: Boolean(slot.is_walkin_enabled) || walkinIssued > 0,
              };
            });
            const totalUsed = rows.reduce((sum, row) => sum + row.used, 0);
            const totalMissed = rows.filter((row) => row.closed).reduce((sum, row) => sum + row.notUsed, 0);
            const totalWaiting = rows.filter((row) => !row.closed).reduce((sum, row) => sum + row.notUsed, 0);
            const muted = { fontSize: 12, color: 'var(--text-secondary)' } as const;
            return (
              <div className="glass-card" style={{ marginTop: 20 }}>
                <h2 style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}><CalendarDays size={22} aria-hidden="true" />枠ごとの状況</h2>
                <p style={{ marginTop: 0, ...muted, fontSize: 13 }}>
                  受け取り済み {totalUsed}人 ／ 受け取らずに終了 {totalMissed}人 ／ 受け取り待ち {totalWaiting}人。人数を押すと、下の一覧がその人たちだけになります。
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                  {rows.map(({ slot, active, walkinIssued, held, occupied, used, notUsed, closed, showWalkin }) => {
                    const optionBreakdown = ticketOptions
                      .map((option) => ({ label: option.label, count: active.filter((r) => r.ticket_option_id === option.id).length }))
                      .filter((item) => item.count > 0);
                    const capacity = slot.total_capacity;
                    const rate = capacity > 0 ? Math.min((occupied / capacity) * 100, 100) : 0;
                    const full = occupied >= capacity;
                    return (
                      <div key={slot.id} className="glass-card" style={{ margin: 0, padding: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <strong>{slot.label}</strong>
                          <span style={{ fontWeight: 800, whiteSpace: 'nowrap', color: full ? 'var(--color-danger)' : undefined }}>{occupied}/{capacity}人</span>
                        </div>
                        <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
                          <div style={{ width: `${rate}%`, height: '100%', background: full ? 'var(--color-danger)' : 'var(--color-primary)' }} />
                        </div>
                        <div style={{ ...muted, marginTop: 4 }}>
                          {full ? '満席' : `残り ${Math.max(capacity - occupied, 0)}人`}
                          {held > 0 && `・事前確保 ${held}人`}
                          {showWalkin && `・当日券 ${walkinIssued}人（今から ${slot.remaining_walkin_slots}人）`}
                        </div>
                        {optionBreakdown.length > 0 && (
                          <div style={{ ...muted, marginTop: 2 }}>
                            券種：{optionBreakdown.map((item) => `${item.label} ${item.count}人`).join('・')}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => showPickupList(slot.id, 'used')} disabled={used === 0}>
                            受け取り済み {used}人
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => showPickupList(slot.id, 'not_used')}
                            disabled={notUsed === 0}
                            style={closed && notUsed > 0 ? { color: 'var(--color-danger)', borderColor: 'var(--color-danger-border)' } : undefined}
                          >
                            {closed ? `受け取らずに終了 ${notUsed}人` : `受け取り待ち ${notUsed}人`}
                          </button>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyEmailList(active, slot.label)} disabled={active.length === 0}>
                            <ClipboardCopy size={14} aria-hidden="true" />メール（{active.length}件）
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {ticketOptions.length > 0 && <TicketOptionSummaryCard options={ticketOptions} reservations={reservations} paymentRequired={paymentRequired} />}

          {surveyQuestions.length > 0 && <SurveySummaryCard questions={surveyQuestions} summary={surveySummary} />}

          {pickupFilter && (
            <div id="reservation-list" className="glass-card" style={{ marginTop: 20, marginBottom: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>
                <strong>{slotById.get(pickupFilter.slotId)?.label}</strong> の
                {pickupFilter.kind === 'used' ? '受け取った人' : pickupClosed(pickupFilter.slotId) ? '受け取らずに終了した人' : 'まだ受け取っていない人'}
                （{filteredReservations.length}人）を表示中
              </span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPickupFilter(null)}>絞り込みを解除</button>
            </div>
          )}

          <div id={pickupFilter ? undefined : 'reservation-list'} className="admin-table-container reservations-table-desktop" style={{ marginTop: 20 }}>
            <table className="admin-table admin-table-stack">
              <thead><tr><th>予約日時</th><th>券種</th><th>氏名</th><th>学籍番号</th><th>開催枠</th><th>大学メールアドレス</th><th>状態</th>{paymentRequired && <th>支払い</th>}<th>操作</th></tr></thead>
              <tbody>
                {filteredReservations.map((res) => (
                  <tr key={res.id} style={{ opacity: res.status === 'cancelled' ? 0.4 : 1 }}>
                    <td data-label="予約日時">{formatDateTime(res.created_at)}</td>
                    <td data-label="券種">
                      {res.ticket_type === 'walkin' ? '当日券' : '予約券'}
                      {res.event_ticket_options && <div style={{ fontSize: '0.8rem' }}>{res.event_ticket_options.label}（{res.event_ticket_options.price_yen.toLocaleString('ja-JP')}円）</div>}
                      {res.survey_answers && Object.keys(res.survey_answers).length > 0 && (
                        <details style={{ fontSize: '0.8rem' }}>
                          <summary>アンケート回答</summary>
                          {surveyQuestions.filter((q) => res.survey_answers && q.id in res.survey_answers).map((q) => {
                            const value = res.survey_answers![q.id];
                            return <div key={q.id}><strong>{q.text}</strong>：{formatSurveyAnswer(value)}</div>;
                          })}
                        </details>
                      )}
                    </td>
                    <td data-label="氏名">{res.student_name}</td>
                    <td data-label="学籍番号">{res.student_number}</td>
                    <td data-label="開催枠">{res.event_slots?.label || '-'}</td>
                    <td data-label="メール">{res.university_email}</td>
                    <td data-label="状態">{res.status === 'used' ? '受け取り済み' : res.status === 'cancelled' ? 'キャンセル' : pickupClosed(res.event_slot_id) ? '受け取らずに終了' : '有効（受け取り待ち）'}</td>
                    {paymentRequired && (
                      <td data-label="支払い">
                        <span className={`badge ${res.payment_status === 'paid' ? 'badge-success' : res.payment_status === 'pending' ? 'badge-warning' : res.payment_status === 'expired' ? 'badge-danger' : 'badge-secondary'}`}>
                          {PAYMENT_LABEL[res.payment_status] ?? res.payment_status}
                        </span>
                        {res.payment_visit_slots && (
                          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>
                            {formatVisitSlot(res.payment_visit_slots)}{res.payment_visit_slots.note ? `（${res.payment_visit_slots.note}）` : ''}
                            <div>{visitSlotPlace(res.payment_visit_slots)}</div>
                          </div>
                        )}
                        {res.status !== 'cancelled' && res.payment_status === 'pending' && visitSlots.length > 0 && (
                          <select
                            className="form-select"
                            style={{ fontSize: '0.8rem', padding: '4px 6px', marginTop: 4 }}
                            aria-label={`${res.student_name}さんの支払い日時を変更`}
                            value=""
                            disabled={changingVisitId === res.id}
                            onChange={(e) => void handleChangeVisitSlot(res, e.target.value)}
                          >
                            <option value="">{changingVisitId === res.id ? '変更中...' : '支払い日時を変更'}</option>
                            {visitSlots.filter((slot) => slot.id !== res.payment_visit_slot_id).map((slot) => (
                              <option key={slot.id} value={slot.id}>
                                {formatVisitSlot(slot)}{slot.note ? `（${slot.note}）` : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    )}
                    <td className="admin-table-stack-actions">{res.status !== 'cancelled' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleCancelReservation(res.id)} disabled={cancellingId === res.id}><X size={15} aria-hidden="true" />取消</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showWipeModal && (
            <div className="modal-overlay" onKeyDown={(e) => { if (e.key === 'Escape' && !wiping) closeWipeModal(); }}>
              <div className="modal-content" role="dialog" aria-modal="true" aria-labelledby="wipe-title">
                <h3 id="wipe-title" className="modal-title"><TriangleAlert size={22} aria-hidden="true" />予約データの完全削除</h3>
                <p className="modal-body">
                  この企画のすべての予約データ（{reservations.length}件）を完全に削除します。元に戻せません。
                  必要なら先に「Excelでダウンロード」で控えを取ってください。
                </p>
                <div className="form-group">
                  <label className="form-label" htmlFor="wipe-confirm">確認のため「完全削除」と入力してください</label>
                  <input id="wipe-confirm" className="form-input" value={wipeConfirmText} onChange={(e) => setWipeConfirmText(e.target.value)} autoFocus autoComplete="off" />
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn btn-secondary" onClick={closeWipeModal} disabled={wiping}>やめる</button>
                  <button type="button" className="btn btn-danger" onClick={handleWipeData} disabled={wiping || wipeConfirmText !== '完全削除'}>{wiping ? '削除実行中...' : '完全に削除する'}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const percent = (count: number, total: number) => (total > 0 ? `${Math.round((count / total) * 1000) / 10}%` : '-');

/** 設問ごとに、選択肢ごとの人数と割合を表示する（キャンセルを除く） */
function SurveySummaryCard({ questions, summary }: { questions: SurveyQuestion[]; summary: SurveyQuestionSummary[] }) {
  const muted = { fontSize: 12, color: 'var(--text-secondary)' } as const;
  return (
    <div className="glass-card" style={{ marginTop: 20 }}>
      <h2 style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}><BarChart3 size={22} aria-hidden="true" />アンケート集計</h2>
      <p style={{ marginTop: 0, ...muted, fontSize: 13 }}>キャンセルを除いた予約の回答です。「Excelでダウンロード」の「アンケート統計」シートにも同じ内容が入ります。</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {summary.map((row, index) => {
          const max = Math.max(1, ...row.counts.map((c) => c.count));
          return (
            <div key={row.question.id} className="glass-card" style={{ margin: 0, padding: 14 }}>
              <strong>Q{index + 1}. {row.question.text}</strong>
              <div style={{ ...muted, marginTop: 2 }}>{summaryNote(questions, row)}</div>
              {row.question.type === 'text' ? (
                row.texts.length > 0 ? (
                  <details style={{ marginTop: 8, fontSize: 13 }}>
                    <summary>回答を見る（{row.texts.length}件）</summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{row.texts.map((text, i) => <li key={i}>{text}</li>)}</ul>
                  </details>
                ) : <div style={{ ...muted, marginTop: 8 }}>まだ回答がありません</div>
              ) : (
                <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                  {row.counts.map((c) => (
                    <div key={c.label}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }}>
                        <span>{c.label}</span>
                        <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{c.count}人（{percent(c.count, row.respondents)}）</span>
                      </div>
                      <div style={{ marginTop: 3, height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
                        <div style={{ width: `${(c.count / max) * 100}%`, height: '100%', background: 'var(--color-primary)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 券種ごとに、何人が選んだかを表示する（キャンセルを除く） */
function TicketOptionSummaryCard({ options, reservations, paymentRequired }: { options: TicketOptionRow[]; reservations: ReservationItem[]; paymentRequired: boolean }) {
  const muted = { fontSize: 12, color: 'var(--text-secondary)' } as const;
  const active = reservations.filter((r) => r.status !== 'cancelled');
  const rows = options.map((option) => {
    const items = active.filter((r) => r.ticket_option_id === option.id);
    return {
      option,
      count: items.length,
      paid: items.filter((r) => r.payment_status === 'paid').length,
      pending: items.filter((r) => r.payment_status === 'pending').length,
      used: items.filter((r) => r.status === 'used').length,
      cancelled: reservations.filter((r) => r.status === 'cancelled' && r.ticket_option_id === option.id).length,
    };
  });
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="glass-card" style={{ marginTop: 20 }}>
      <h2 style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}><Ticket size={22} aria-hidden="true" />券種ごとの人数</h2>
      <p style={{ marginTop: 0, ...muted, fontSize: 13 }}>
        券種を選んだ人の合計 <strong style={{ fontSize: 16, color: 'var(--text-primary)' }}>{total}人</strong>（キャンセルを除く）。「Excelでダウンロード」の集計シートにも金額つきで入ります。
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {rows.map(({ option, count, paid, pending, used, cancelled }) => (
          <div key={option.id} className="glass-card" style={{ margin: 0, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
              <strong>{formatTicketOption(option.label, option.price_yen)}</strong>
              <span style={{ fontWeight: 800, whiteSpace: 'nowrap' }}>{count}人</span>
            </div>
            <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: 'var(--color-primary)' }} />
            </div>
            <div style={{ ...muted, marginTop: 4 }}>
              全体の {percent(count, total)}
              {paymentRequired && `・支払い済み ${paid}人・未払い ${pending}人`}
              {`・受け取り済み ${used}人`}
              {cancelled > 0 && `・キャンセル ${cancelled}人`}
              {!option.is_enabled && '・受付停止中'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
