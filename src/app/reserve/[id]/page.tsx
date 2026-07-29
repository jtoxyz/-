'use client';

export const runtime = 'edge';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarDays, Ticket, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  type AccountEvent,
  type AccountEventSlot,
  type StudentProfile,
  accountSlotStatus,
  canGetWalkinSlot,
  canReserveSlot,
  formatAccountDate,
} from '@/lib/studentAccount';

type BulkResult = { id: string; slot_label: string };

export default function AccountReservationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [event, setEvent] = useState<AccountEvent | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [slots, setSlots] = useState<AccountEventSlot[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<BulkResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!user) return;

      const [profileResult, eventResult, slotResult] = await Promise.all([
        supabase.from('user_profiles').select('student_name, student_number, university_email').eq('user_id', user.id).single(),
        supabase.from('events').select('id, title, description, slot_selection_mode').eq('id', id).eq('is_public', true).single(),
        supabase.rpc('get_event_slots', { p_event_id: id }),
      ]);

      if (profileResult.error || !profileResult.data) setError('アカウント情報を取得できませんでした。');
      else if (eventResult.error || !eventResult.data) setError('企画が見つからないか、公開されていません。');
      else {
        setProfile(profileResult.data as StudentProfile);
        setEvent(eventResult.data as AccountEvent);
        setSlots(((slotResult.data as AccountEventSlot[] | null) || []).filter((slot) => slot.is_enabled));
      }
      setLoading(false);
    };
    void load();
  }, [id]);

  const selectedSlots = useMemo(() => slots.filter((slot) => selected.includes(slot.id)), [slots, selected]);
  const reservable = selectedSlots.length > 0 && selectedSlots.every(canReserveSlot);
  const walkinAvailable = selectedSlots.length === 1 && canGetWalkinSlot(selectedSlots[0]);

  const toggle = (slot: AccountEventSlot) => {
    if (!event || (!canReserveSlot(slot) && !canGetWalkinSlot(slot))) return;
    if (event.slot_selection_mode === 'single') setSelected([slot.id]);
    else setSelected((current) => current.includes(slot.id) ? current.filter((value) => value !== slot.id) : [...current, slot.id]);
  };

  const reserve = async () => {
    if (!event || !reservable) return;
    setSaving(true);
    setError(null);

    if (event.slot_selection_mode === 'multiple' && selected.length > 1) {
      const { data, error: rpcError } = await supabase.rpc('create_my_reservations_bulk', {
        p_event_id: event.id,
        p_event_slot_ids: selected,
      });
      if (rpcError) setError(rpcError.message || '予約に失敗しました。');
      else setResults((data as BulkResult[] | null) || []);
      setSaving(false);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc('create_my_reservation', {
      p_event_id: event.id,
      p_event_slot_id: selected[0],
    });
    if (rpcError) setError(rpcError.message || '予約に失敗しました。');
    else {
      const reservationId = String((data as { id?: string } | null)?.id || '');
      reservationId ? router.push(`/my-tickets/${reservationId}`) : router.push('/#my-tickets');
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
    if (rpcError) setError(rpcError.message || '当日券の取得に失敗しました。');
    else {
      const reservationId = String((data as { id?: string } | null)?.id || '');
      reservationId ? router.push(`/my-tickets/${reservationId}`) : router.push('/#my-tickets');
    }
    setSaving(false);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 64 }}><div className="loading-spinner" /></div>;

  if (!event || !profile) {
    return <div className="glass-card text-center" style={{ padding: 36 }}><div className="error-banner">{error || '企画情報を読み込めませんでした。'}</div><Link href="/"><button className="btn btn-secondary" style={{ marginTop: 18 }}>企画一覧へ戻る</button></Link></div>;
  }

  if (results.length > 0) {
    return (
      <div className="glass-card" style={{ maxWidth: 620, margin: '20px auto' }}>
        <h1 style={{ textAlign: 'center', marginBottom: 20 }}>予約が完了しました</h1>
        <div style={{ display: 'grid', gap: 10 }}>
          {results.map((result) => <Link key={result.id} href={`/my-tickets/${result.id}`} className="glass-card interactive" style={{ padding: 14, display: 'flex', justifyContent: 'space-between' }}><span>{result.slot_label}</span><strong>チケットを表示</strong></Link>)}
        </div>
        <Link href="/"><button className="btn btn-secondary" style={{ width: '100%', marginTop: 18 }}>企画一覧へ戻る</button></Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}><Link href="/">← 企画一覧へ戻る</Link></div>
      <div className="glass-card" style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.6rem', marginBottom: 10 }}>{event.title}</h1>
        {event.description && <div style={{ color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', lineHeight: 1.75 }}>{event.description}</div>}
      </div>

      <div className="glass-card" style={{ marginBottom: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <UserRound size={26} style={{ color: 'var(--color-primary)' }} aria-hidden="true" />
        <div><small style={{ color: 'var(--text-secondary)' }}>予約者</small><div style={{ fontWeight: 800 }}>{profile.student_name} <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>（{profile.student_number}）</span></div></div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 18 }}>{error}</div>}

      <div className="glass-card">
        <h2 style={{ fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}><CalendarDays size={22} aria-hidden="true" />参加する枠を選択</h2>
        <div style={{ display: 'grid', gap: 10 }}>
          {slots.map((slot) => {
            const active = selected.includes(slot.id);
            const selectable = canReserveSlot(slot) || canGetWalkinSlot(slot);
            return (
              <button key={slot.id} type="button" onClick={() => toggle(slot)} disabled={!selectable || saving} className="glass-card interactive" style={{ textAlign: 'left', width: '100%', padding: 15, opacity: selectable ? 1 : 0.55, borderColor: active ? 'var(--color-primary)' : 'var(--card-border)', background: active ? 'var(--color-primary-glow)' : 'var(--card-bg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><strong>{slot.label}</strong><div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>{formatAccountDate(slot.starts_at)} 〜 {formatAccountDate(slot.ends_at)}</div></div><span className={`badge ${selectable ? 'badge-success' : 'badge-secondary'}`}>{accountSlotStatus(slot)}</span></div>
              </button>
            );
          })}
        </div>
        {slots.length === 0 && <p style={{ color: 'var(--text-secondary)' }}>現在選択できる開催枠はありません。</p>}

        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-primary" onClick={reserve} disabled={!reservable || saving}><Ticket size={18} aria-hidden="true" />{saving ? '処理中...' : '選択した枠を予約する'}</button>
          <button type="button" className="btn btn-secondary" onClick={getWalkin} disabled={!walkinAvailable || saving}>{saving ? '処理中...' : '選択した枠の当日券を取得する'}</button>
        </div>
      </div>
    </div>
  );
}
