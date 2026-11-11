'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Banknote, CalendarDays, MapPin, Ticket, UserRound } from 'lucide-react';
import RichText from '@/components/RichText';
import { supabase } from '@/lib/supabase';
import { type PaymentVisitSlot, fetchSelectableVisitSlots, formatVisitSlot, visitSlotPlace, visitWindowNotice } from '@/lib/paymentVisit';
import {
  type AccountEvent,
  type AccountEventSlot,
  type StudentProfile,
  accountSlotStatus,
  canGetWalkinSlot,
  canReserveSlot,
  formatAccountDate,
} from '@/lib/studentAccount';
import { type SurveyQuestion, missingRequiredAnswer, pruneHiddenAnswers, visibleQuestionIds } from '@/lib/survey';
import { useQueryParam } from '@/hooks/useQueryParam';

type BulkResult = { id: string; slot_label: string };

type TicketOptionRow = {
  id: string; label: string; description: string | null; price_yen: number; requires_survey: boolean;
  sort_order: number; event_slot_id: string; per_slot_limit: number | null; used_count: number;
};

export default function AccountReservationPage() {
  const router = useRouter();
  const eventId = useQueryParam('id');
  const [event, setEvent] = useState<AccountEvent | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [slots, setSlots] = useState<AccountEventSlot[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [visitSlots, setVisitSlots] = useState<PaymentVisitSlot[]>([]);
  const [visitSlotId, setVisitSlotId] = useState('');
  const [optionRows, setOptionRows] = useState<TicketOptionRow[]>([]);
  const [optionId, setOptionId] = useState('');
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [surveyIntro, setSurveyIntro] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 予約に失敗したとき（満席になった等）に、枠の状態だけ読み直す
  const reloadSlots = useCallback(async () => {
    if (!eventId) return;
    const { data } = await supabase.rpc('get_event_slots', { p_event_id: eventId });
    if (data) setSlots(((data as AccountEventSlot[] | null) || []).filter((slot) => slot.is_enabled));
    const optionResult = await supabase.rpc('get_event_ticket_options', { p_event_id: eventId });
    if (!optionResult.error) setOptionRows((optionResult.data as TicketOptionRow[] | null) ?? []);
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;

    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) {
        setError('ログインの有効期限が切れました。もう一度ログインしてください。');
        setLoading(false);
        return;
      }

      const [profileResult, eventResult, slotResult] = await Promise.all([
        supabase.from('user_profiles').select('student_name, student_number, university_email').eq('user_id', user.id).single(),
        supabase.from('events').select('id, title, description, slot_selection_mode, payment_required, payment_visit_required, payment_visit_window_days, survey_config').eq('id', eventId).eq('is_public', true).single(),
        supabase.rpc('get_event_slots', { p_event_id: eventId }),
      ]);

      if (profileResult.error || !profileResult.data) setError('アカウント情報を取得できませんでした。');
      else if (eventResult.error || !eventResult.data) setError('企画が見つからないか、公開されていません。');
      else {
        const loadedEvent = eventResult.data as AccountEvent;
        const loadedSlots = ((slotResult.data as AccountEventSlot[] | null) || []).filter((slot) => slot.is_enabled);
        setProfile(profileResult.data as StudentProfile);
        setEvent(loadedEvent);
        setSlots(loadedSlots);

        const surveyConfig = (eventResult.data as { survey_config?: { intro?: string; questions?: SurveyQuestion[] } | null }).survey_config;
        setQuestions(surveyConfig?.questions ?? []);
        setSurveyIntro(surveyConfig?.intro ?? '');
        const optionResult = await supabase.rpc('get_event_ticket_options', { p_event_id: eventId });
        if (!optionResult.error) setOptionRows((optionResult.data as TicketOptionRow[] | null) ?? []);

        if (loadedEvent.payment_required && loadedEvent.payment_visit_required) {
          try {
            setVisitSlots(await fetchSelectableVisitSlots(loadedEvent.payment_visit_window_days ?? null));
          } catch {
            setError('支払い日時の候補を取得できませんでした。');
          }
        }

        if (loadedEvent.slot_selection_mode === 'single') {
          const selectable = loadedSlots.filter((slot) => canReserveSlot(slot) || canGetWalkinSlot(slot));
          if (selectable.length === 1) setSelected([selectable[0].id]);
        }
      }
      setLoading(false);
    };

    void load();
  }, [eventId]);

  const selectedSlots = useMemo(() => slots.filter((slot) => selected.includes(slot.id)), [slots, selected]);
  const visitRequired = Boolean(event?.payment_required && event?.payment_visit_required);
  // 券種がある企画は、券種とアンケートを1枠ずつ選ぶため、枠は1つだけ選べる
  const hasOptions = optionRows.length > 0;
  const slotOptions = optionRows.filter((row) => selected.length === 1 && row.event_slot_id === selected[0]);
  const chosenOption = slotOptions.find((row) => row.id === optionId);
  const optionFull = (row: TicketOptionRow) => row.per_slot_limit !== null && row.used_count >= row.per_slot_limit;
  // 分岐: 前の答えによって出す設問が変わる。必須チェックは表示中の設問だけ
  const visibleIds = visibleQuestionIds(questions, answers);
  const visibleQuestions = questions.filter((q) => visibleIds.has(q.id));
  const surveyMissing = Boolean(chosenOption?.requires_survey) && missingRequiredAnswer(questions, answers);
  const optionReady = !hasOptions || (Boolean(chosenOption) && !optionFull(chosenOption!) && !surveyMissing);
  const reservable = selectedSlots.length > 0 && selectedSlots.every(canReserveSlot) && (!visitRequired || visitSlotId !== '') && optionReady;
  const walkinAvailable = selectedSlots.length === 1 && canGetWalkinSlot(selectedSlots[0]);
  // 当日券を受け付ける枠が1つもない企画では、当日券ボタン自体を出さない
  const hasWalkinSlots = slots.some((slot) => slot.is_enabled && slot.is_walkin_enabled);
  // 支払い場所は受付枠ごとに決まる。候補の中で場所が1つだけなら見出しに出す
  const visitPlaces = [...new Set(visitSlots.map(visitSlotPlace))];
  const selectedVisit = visitSlots.find((visit) => visit.id === visitSlotId);

  const setAnswer = (id: string, value: string | string[]) => setAnswers((current) => ({ ...current, [id]: value }));

  // 予約ボタンを押せない理由（押せるときは null）
  const reserveBlocker = (() => {
    if (selectedSlots.length === 0) return '参加する枠を選んでください。';
    if (!selectedSlots.every(canReserveSlot)) return '選んだ枠は今は予約できません（当日券のみ、または受付時間外です）。';
    if (hasOptions && !chosenOption) return '券種を選んでください。';
    if (chosenOption && optionFull(chosenOption)) return '選んだ券種はこの枠では満席です。';
    if (surveyMissing) return '必須のアンケートに回答してください。';
    if (visitRequired && visitSlots.length === 0) return '選べる支払い日時がありません。';
    if (visitRequired && !visitSlotId) return '支払いに来る日時を選んでください。';
    return null;
  })();

  const openTicket = (data: unknown) => {
    const reservationId = String((data as { id?: string } | null)?.id || '');
    router.push(reservationId ? `/my-tickets?reservationId=${encodeURIComponent(reservationId)}` : '/#my-tickets');
  };

  const toggle = (slot: AccountEventSlot) => {
    if (!event || (!canReserveSlot(slot) && !canGetWalkinSlot(slot))) return;
    if (selected[0] !== slot.id) setOptionId('');
    if (event.slot_selection_mode === 'single' || hasOptions) setSelected([slot.id]);
    else setSelected((current) => current.includes(slot.id) ? current.filter((value) => value !== slot.id) : [...current, slot.id]);
  };

  const reserve = async () => {
    if (!event || !reservable) return;
    setSaving(true);
    setError(null);

    if (event.slot_selection_mode === 'multiple' && selected.length > 1 && !hasOptions) {
      const { data, error: rpcError } = await supabase.rpc('create_my_reservations_bulk', {
        p_event_id: event.id,
        p_event_slot_ids: selected,
        p_payment_visit_slot_id: visitRequired ? visitSlotId : null,
      });
      if (rpcError) {
        setError(rpcError.message || '予約に失敗しました。');
        void reloadSlots();
      } else setResults((data as BulkResult[] | null) || []);
      setSaving(false);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc('create_my_reservation', {
      p_event_id: event.id,
      p_event_slot_id: selected[0],
      p_payment_visit_slot_id: visitRequired ? visitSlotId : null,
      p_ticket_option_id: hasOptions ? optionId : null,
      p_survey_answers: hasOptions && chosenOption?.requires_survey ? pruneHiddenAnswers(questions, answers) : null,
    });
    if (rpcError) {
      setError(rpcError.message || '予約に失敗しました。');
      void reloadSlots();
    } else {
      openTicket(data);
    }
    setSaving(false);
  };

  const getWalkin = async () => {
    if (!event || !walkinAvailable) return;
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('create_my_walkin_reservation', {
      p_event_id: event.id,
      p_event_slot_id: selected[0],
    });
    if (rpcError) {
      setError(rpcError.message || '当日券の取得に失敗しました。');
      void reloadSlots();
    } else {
      openTicket(data);
    }
    setSaving(false);
  };

  if (eventId === null) {
    return <div className="glass-card text-center" style={{ padding: 36 }}><div className="error-banner">企画が指定されていません。</div><Link href="/" className="btn btn-secondary" style={{ marginTop: 18 }}>企画一覧へ戻る</Link></div>;
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 64 }}><div className="loading-spinner" /></div>;

  if (!event || !profile) {
    return <div className="glass-card text-center" style={{ padding: 36 }}><div className="error-banner">{error || '企画情報を読み込めませんでした。'}</div><Link href="/" className="btn btn-secondary" style={{ marginTop: 18 }}>企画一覧へ戻る</Link></div>;
  }

  if (results.length > 0) {
    return (
      <div className="glass-card" style={{ maxWidth: 620, margin: '20px auto' }}>
        <h1 style={{ textAlign: 'center', marginBottom: 20 }}>予約が完了しました</h1>
        <div style={{ display: 'grid', gap: 10 }}>
          {results.map((result) => <Link key={result.id} href={`/my-tickets?reservationId=${encodeURIComponent(result.id)}`} className="glass-card interactive" style={{ padding: 14, display: 'flex', justifyContent: 'space-between' }}><span>{result.slot_label}</span><strong>チケットを表示</strong></Link>)}
        </div>
        <Link href="/" className="btn btn-secondary" style={{ width: '100%', marginTop: 18 }}>企画一覧へ戻る</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}><Link href="/">← 企画一覧へ戻る</Link></div>
      <div className="glass-card" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.6rem', marginBottom: 10 }}>{event.title}</h1>
        {event.description && <RichText content={event.description} style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }} />}
      </div>

      <div className="glass-card" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <UserRound size={26} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
        <div><small style={{ color: 'var(--text-secondary)' }}>予約者</small><div style={{ fontWeight: 800 }}>{profile.student_name} <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>（{profile.student_number}）</span></div></div>
      </div>

      {error && <div className="error-banner" role="alert" style={{ marginBottom: 18 }}>{error}</div>}

      <div className="glass-card">
        <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><CalendarDays size={22} aria-hidden="true" />参加する枠を選択</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {slots.map((slot) => {
            const active = selected.includes(slot.id);
            const selectable = canReserveSlot(slot) || canGetWalkinSlot(slot);
            return (
              <button key={slot.id} type="button" onClick={() => toggle(slot)} disabled={!selectable || saving} aria-pressed={active} className="glass-card interactive" style={{ textAlign: 'left', width: '100%', padding: 15, opacity: selectable ? 1 : 0.55, borderColor: active ? 'var(--color-primary)' : 'var(--card-border)', background: active ? 'var(--color-primary-glow)' : 'var(--card-bg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}><div><strong>{slot.label}</strong><div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>{formatAccountDate(slot.starts_at)} 〜 {formatAccountDate(slot.ends_at)}</div></div><span className={`badge ${selectable ? 'badge-success' : 'badge-secondary'}`}>{accountSlotStatus(slot)}</span></div>
              </button>
            );
          })}
        </div>
        {slots.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>現在選択できる開催枠はありません。</p>}

        {hasOptions && (
          <div style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Ticket size={22} aria-hidden="true" />券種を選択</h2>
            {selected.length !== 1 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>先に上で参加する枠を1つ選んでください。</p>}
            <div style={{ display: 'grid', gap: 8 }}>
              {slotOptions.map((row) => {
                const active = optionId === row.id;
                const full = optionFull(row);
                return (
                  <button key={row.id} type="button" onClick={() => setOptionId(row.id)} disabled={full || saving} aria-pressed={active} className="glass-card interactive" style={{ textAlign: 'left', width: '100%', padding: 13, opacity: full ? 0.55 : 1, borderColor: active ? 'var(--color-primary)' : 'var(--card-border)', background: active ? 'var(--color-primary-glow)' : 'var(--card-bg)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>{row.label}</strong><strong>{row.price_yen.toLocaleString('ja-JP')}円</strong></div>
                    {row.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>{row.description}</div>}
                    {row.requires_survey && <div style={{ fontSize: '0.8rem', marginTop: 4 }}>アンケートへの回答が必要です</div>}
                    {full && <div style={{ fontSize: '0.8rem', marginTop: 4 }}>この枠では満席です</div>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {chosenOption?.requires_survey && (
          <div style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: '1.2rem', marginBottom: 6 }}>アンケート</h2>
            {surveyIntro && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>{surveyIntro}</p>}
            <div style={{ display: 'grid', gap: 16 }}>
              {visibleQuestions.map((q) => (
                <fieldset key={q.id} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                  <legend style={{ fontWeight: 700, marginBottom: 6, padding: 0 }}>{q.text}{q.required && <span style={{ color: 'var(--color-danger)' }}> *<span className="visually-hidden">（必須）</span></span>}</legend>
                  {q.type === 'text' && <textarea className="form-input" rows={3} maxLength={1000} aria-label={q.text} value={String(answers[q.id] ?? '')} onChange={(e) => setAnswer(q.id, e.target.value)} />}
                  {q.type === 'single' && (q.options ?? []).map((opt) => (
                    <label key={opt} style={{ display: 'flex', gap: 8, padding: '4px 0' }}><input type="radio" name={q.id} checked={answers[q.id] === opt} onChange={() => setAnswer(q.id, opt)} />{opt}</label>
                  ))}
                  {q.type === 'multiple' && (q.options ?? []).map((opt) => {
                    const current = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
                    return <label key={opt} style={{ display: 'flex', gap: 8, padding: '4px 0' }}><input type="checkbox" checked={current.includes(opt)} onChange={() => setAnswer(q.id, current.includes(opt) ? current.filter((v) => v !== opt) : [...current, opt])} />{opt}</label>;
                  })}
                  {q.type === 'rating' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-pressed={answers[q.id] === String(n)} className={`btn ${answers[q.id] === String(n) ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setAnswer(q.id, String(n))}>{n}</button>)}
                    </div>
                  )}
                </fieldset>
              ))}
            </div>
          </div>
        )}

        {visitRequired && (
          <div style={{ marginTop: 22 }}>
            <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}><Banknote size={22} aria-hidden="true" />支払いに来る日時を選択</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 12 }}>
              {visitPlaces.length > 1
                ? '支払い場所は日によって違います。各日時に書いてある場所で支払ってください。'
                : `選んだ日時に${visitPlaces[0] ?? ''}で支払ってください。`}
              時間内に支払いがない場合、予約は自動でキャンセルされます。
              {visitWindowNotice(event.payment_visit_window_days)}
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {visitSlots.map((visit) => {
                const active = visitSlotId === visit.id;
                return (
                  <button key={visit.id} type="button" onClick={() => setVisitSlotId(visit.id)} disabled={saving} aria-pressed={active} className="glass-card interactive" style={{ textAlign: 'left', width: '100%', padding: 13, borderColor: active ? 'var(--color-primary)' : 'var(--card-border)', background: active ? 'var(--color-primary-glow)' : 'var(--card-bg)' }}>
                    <strong>{formatVisitSlot(visit)}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.88rem', fontWeight: 700, marginTop: 4 }}><MapPin size={15} aria-hidden="true" />{visitSlotPlace(visit)}</div>
                    {visit.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>{visit.note}</div>}
                  </button>
                );
              })}
            </div>
            {visitSlots.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>今は選べる支払い日時がないため予約できません。委員会にお問い合わせください。</p>}
            {selectedVisit && <p style={{ marginTop: 12, fontWeight: 700 }}>支払い場所：{visitSlotPlace(selectedVisit)}（{formatVisitSlot(selectedVisit)}）</p>}
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-primary" onClick={reserve} disabled={!reservable || saving} aria-describedby={reserveBlocker ? 'reserve-blocker' : undefined}><Ticket size={18} aria-hidden="true" />{saving ? '処理中...' : '選択した枠を予約する'}</button>
          {reserveBlocker && !walkinAvailable && <p id="reserve-blocker" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{reserveBlocker}</p>}
          {hasWalkinSlots && <button type="button" className="btn btn-secondary" onClick={getWalkin} disabled={!walkinAvailable || saving}>{saving ? '処理中...' : '選択した枠の当日券を取得する'}</button>}
        </div>
      </div>
    </div>
  );
}
