'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, ChartColumn, DoorOpen, LogIn, QrCode, RefreshCw, TriangleAlert } from 'lucide-react';
import DailyPaymentQr from '@/components/payment/DailyPaymentQr';
import DynamicPaymentQr from '@/components/payment/DynamicPaymentQr';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { formatJstDateTime } from '@/lib/jst';
import { formatVisitSlot, visitSlotPlace } from '@/lib/paymentVisit';
import { staffDailyQr, staffLaneQr } from '@/lib/paymentQrRpc';
import { supabase } from '@/lib/supabase';

type StaffEvent = { id: string; title: string; payment_required: boolean; is_public: boolean; starts_at: string | null; ends_at: string | null };

type SlotStats = {
  slot_id: string;
  slot_label: string;
  starts_at: string | null;
  ends_at: string | null;
  is_enabled: boolean;
  total_capacity: number;
  reservation_count: number;
  walkin_count: number;
  used_count: number;
  waiting_count: number;
  cancelled_count: number;
  paid_count: number;
  unpaid_count: number;
  remaining_reservation_slots: number | null;
  remaining_walkin_slots: number | null;
};

type VisitStats = {
  visit_slot_id: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  note: string | null;
  waiting_count: number;
  paid_count: number;
  expired_count: number;
};

type Access =
  | { status: 'checking' }
  | { status: 'signed-out' }
  | { status: 'not-staff'; email: string }
  | { status: 'error'; message: string }
  | { status: 'ok'; name: string | null; events: StaffEvent[] };

type Tab = 'stats' | 'dynamic' | 'daily';

const fetchLaneQr = staffLaneQr(supabase);
const fetchDailyQr = staffDailyQr(supabase);
const STATS_REFRESH_MS = 30_000;

const n = (value: number | string | null | undefined) => Number(value ?? 0);

export default function StaffPage() {
  const [access, setAccess] = useState<Access>({ status: 'checking' });
  const [eventId, setEventId] = useState('');
  const [tab, setTab] = useState<Tab>('stats');

  useLoadEffect(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session?.user) {
      setAccess({ status: 'signed-out' });
      return;
    }

    const { data: statusData, error: statusError } = await supabase.rpc('get_my_staff_status');
    if (statusError) {
      setAccess({ status: 'error', message: statusError.message });
      return;
    }
    const status = (Array.isArray(statusData) ? statusData[0] : statusData) as { is_staff: boolean; is_admin: boolean; display_name: string | null } | undefined;
    if (!status?.is_staff && !status?.is_admin) {
      setAccess({ status: 'not-staff', email: session.user.email || '' });
      return;
    }

    const { data: eventData, error: eventError } = await supabase.rpc('staff_list_events');
    if (eventError) {
      setAccess({ status: 'error', message: eventError.message });
      return;
    }
    const events = (eventData as StaffEvent[] | null) || [];
    setAccess({ status: 'ok', name: status.display_name, events });
    setEventId((current) => current || events[0]?.id || '');
  }, []);

  if (access.status === 'checking') {
    return <div style={{ textAlign: 'center', padding: 64 }} role="status"><div className="loading-spinner" /><p style={{ color: 'var(--text-secondary)' }}>スタッフ情報を確認しています...</p></div>;
  }

  if (access.status === 'signed-out') {
    return (
      <div className="glass-card" style={{ maxWidth: 560, margin: '32px auto', textAlign: 'center' }}>
        <BadgeCheck size={44} aria-hidden="true" style={{ color: 'var(--color-primary)', marginBottom: 10 }} />
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>スタッフ用画面</h1>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 20 }}>
          自治会などの担当スタッフが、支払いQRの表示と受付状況の確認に使います。登録された大学Googleアカウントでログインしてください。
        </p>
        <Link href="/login?next=%2Fstaff" className="btn btn-primary"><LogIn size={18} aria-hidden="true" />ログインする</Link>
      </div>
    );
  }

  if (access.status === 'not-staff' || access.status === 'error') {
    return (
      <div className="glass-card" style={{ maxWidth: 560, margin: '32px auto' }}>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 12 }}>スタッフ用画面</h1>
        <div className="error-banner" role="alert">
          <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>
            {access.status === 'not-staff'
              ? <>このアカウント（<strong className="nowrap">{access.email}</strong>）はスタッフとして登録されていません。委員会の管理者に登録を依頼してください。</>
              : `スタッフ情報を確認できませんでした：${access.message}`}
          </span>
        </div>
        <Link href="/" className="btn btn-secondary">企画一覧へ戻る</Link>
      </div>
    );
  }

  const event = access.events.find((row) => row.id === eventId);
  const tabs: { id: Tab; label: string; icon: typeof ChartColumn; enabled: boolean }[] = [
    { id: 'stats', label: '受付状況', icon: ChartColumn, enabled: true },
    { id: 'dynamic', label: '動的QR', icon: QrCode, enabled: Boolean(event?.payment_required) },
    { id: 'daily', label: '1日QR', icon: QrCode, enabled: Boolean(event?.payment_required) },
  ];
  const activeTab = tabs.find((t) => t.id === tab && t.enabled) ? tab : 'stats';

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="glass-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <BadgeCheck size={26} aria-hidden="true" style={{ color: 'var(--color-primary)' }} />
          <h1 style={{ fontSize: '1.5rem' }}>スタッフ用画面</h1>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.7 }}>
          {access.name ? `${access.name}さん、` : ''}担当している企画の支払いQRと受付状況を確認できます。企画の設定や予約者の個人情報は表示されません。
        </p>

        {access.events.length === 0 ? (
          <p style={{ marginTop: 16, color: 'var(--text-secondary)' }}>担当している企画はまだありません。委員会の管理者に割り当てを依頼してください。</p>
        ) : (
          <div className="form-group" style={{ marginTop: 16, marginBottom: 0 }}>
            <label className="form-label" htmlFor="staff-event">企画</label>
            <select id="staff-event" className="form-input" value={eventId} onChange={(e) => setEventId(e.target.value)}>
              {access.events.map((row) => (
                <option key={row.id} value={row.id}>{row.title}{row.is_public ? '' : '（非公開）'}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {event && (
        <>
          <div className="admin-tabs staff-tabs" role="tablist" aria-label="スタッフ用の機能" style={{ marginBottom: 16 }}>
            {tabs.filter((t) => t.enabled).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`admin-tab ${activeTab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                <Icon size={16} aria-hidden="true" style={{ verticalAlign: 'middle', marginRight: 6 }} />{label}
              </button>
            ))}
          </div>

          <div className="glass-card" role="tabpanel">
            {activeTab === 'stats' && <EventStats event={event} />}
            {activeTab === 'dynamic' && (
              <>
                <h2 style={{ fontSize: '1.2rem', marginBottom: 6 }}>動的支払いQR</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.7, marginBottom: 12 }}>
                  このスマホ・タブレット専用の一回限りのQRです。学生が読み取ると、この端末だけ次のQRに切り替わります。複数の端末で同時に開けます。
                </p>
                <DynamicPaymentQr eventId={event.id} fetchQr={fetchLaneQr} />
              </>
            )}
            {activeTab === 'daily' && (
              <>
                <h2 style={{ fontSize: '1.2rem', marginBottom: 6 }}>1日支払いQR</h2>
                <DailyPaymentQr eventId={event.id} eventTitle={event.title} mode="staff" issue={fetchDailyQr} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 枠ごとの予約数・受け取り数・支払い数（人数だけ） */
function EventStats({ event }: { event: StaffEvent }) {
  const [slots, setSlots] = useState<SlotStats[] | null>(null);
  const [visits, setVisits] = useState<VisitStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [statsResult, visitResult] = await Promise.all([
      supabase.rpc('staff_get_event_stats', { p_event_id: event.id }),
      event.payment_required ? supabase.rpc('staff_get_payment_visit_stats', { p_event_id: event.id }) : Promise.resolve({ data: [], error: null }),
    ]);
    if (statsResult.error) {
      setError(statsResult.error.message);
    } else {
      setError(null);
      setSlots((statsResult.data as SlotStats[] | null) || []);
      setVisits(visitResult.error ? [] : ((visitResult.data as VisitStats[] | null) || []));
      setUpdatedAt(new Date().toISOString());
    }
  }, [event.id, event.payment_required]);

  useLoadEffect(() => load(), [load]);

  // 受付中は30秒ごとに自動で更新する
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, STATS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (error) {
    return <div className="error-banner" role="alert"><TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} /><span>{error}</span></div>;
  }
  if (!slots) return <div style={{ textAlign: 'center', padding: 24 }} role="status"><div className="loading-spinner" /></div>;

  const total = slots.reduce(
    (sum, s) => ({
      booked: sum.booked + n(s.reservation_count) + n(s.walkin_count),
      used: sum.used + n(s.used_count),
      waiting: sum.waiting + n(s.waiting_count),
      paid: sum.paid + n(s.paid_count),
      unpaid: sum.unpaid + n(s.unpaid_count),
      capacity: sum.capacity + n(s.total_capacity),
    }),
    { booked: 0, used: 0, waiting: 0, paid: 0, unpaid: 0, capacity: 0 },
  );

  const stat = (label: string, value: number, note?: string) => (
    <div className="glass-card" style={{ margin: 0, padding: 14 }}>
      <small style={{ color: 'var(--text-secondary)' }}>{label}</small>
      <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>{value}</div>
      {note && <small style={{ color: 'var(--text-secondary)' }}>{note}</small>}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <h2 style={{ fontSize: '1.2rem' }}>受付状況</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {updatedAt && <small style={{ color: 'var(--text-secondary)' }} aria-live="polite">{formatJstDateTime(updatedAt)} 時点</small>}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={15} aria-hidden="true" />{refreshing ? '更新中…' : '更新'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
        {stat('予約数', total.booked, `定員 ${total.capacity}人`)}
        {stat('受付済み', total.used, 'チケット使用済み')}
        {stat('受付待ち', total.waiting, 'まだ来ていない人')}
        {event.payment_required && stat('支払い済み', total.paid)}
        {event.payment_required && stat('未払い', total.unpaid)}
      </div>

      {slots.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>開催枠がありません。</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {slots.map((slot) => {
            const booked = n(slot.reservation_count) + n(slot.walkin_count);
            const capacity = n(slot.total_capacity);
            const rate = capacity > 0 ? Math.min((booked / capacity) * 100, 100) : 0;
            const usedRate = booked > 0 ? Math.min((n(slot.used_count) / booked) * 100, 100) : 0;
            const full = capacity > 0 && booked >= capacity;
            return (
              <div key={slot.slot_id} className="glass-card" style={{ margin: 0, padding: 14, opacity: slot.is_enabled ? 1 : 0.6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <strong>{slot.slot_label}</strong>
                  <span style={{ fontWeight: 800, whiteSpace: 'nowrap', color: full ? 'var(--color-danger)' : undefined }}>{booked}/{capacity}人</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {formatJstDateTime(slot.starts_at)} 〜{!slot.is_enabled && '（停止中）'}
                </div>
                <div style={{ marginTop: 8, height: 6, borderRadius: 999, background: 'rgba(127,127,127,0.25)', overflow: 'hidden' }} aria-hidden="true">
                  <div style={{ width: `${rate}%`, height: '100%', background: full ? 'var(--color-danger)' : 'var(--color-primary)' }} />
                </div>
                <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px', marginTop: 10, fontSize: 13 }}>
                  <dt style={{ color: 'var(--text-secondary)' }}>受付済み</dt><dd style={{ fontWeight: 700 }}>{n(slot.used_count)}人（{Math.round(usedRate)}%）</dd>
                  <dt style={{ color: 'var(--text-secondary)' }}>受付待ち</dt><dd style={{ fontWeight: 700 }}>{n(slot.waiting_count)}人</dd>
                  {n(slot.walkin_count) > 0 && <><dt style={{ color: 'var(--text-secondary)' }}>うち当日券</dt><dd>{n(slot.walkin_count)}人</dd></>}
                  {event.payment_required && <><dt style={{ color: 'var(--text-secondary)' }}>支払い</dt><dd>済み {n(slot.paid_count)}人 ／ 未払い {n(slot.unpaid_count)}人</dd></>}
                  <dt style={{ color: 'var(--text-secondary)' }}>残り</dt><dd>予約 {n(slot.remaining_reservation_slots)}人 ／ 当日券 {n(slot.remaining_walkin_slots)}人</dd>
                  {n(slot.cancelled_count) > 0 && <><dt style={{ color: 'var(--text-secondary)' }}>キャンセル</dt><dd>{n(slot.cancelled_count)}人</dd></>}
                </dl>
              </div>
            );
          })}
        </div>
      )}

      {event.payment_required && visits.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <DoorOpen size={18} aria-hidden="true" />支払い受付の来室予定
          </h3>
          <div className="admin-table-container">
            <table className="admin-table admin-table-stack">
              <thead><tr><th>日時</th><th>場所</th><th>来室予定（未払い）</th><th>支払い済み</th><th>期限切れ</th></tr></thead>
              <tbody>
                {visits.map((visit) => (
                  <tr key={visit.visit_slot_id}>
                    <td className="admin-table-stack-title">{formatVisitSlot(visit)}</td>
                    <td data-label="場所">{visitSlotPlace(visit)}</td>
                    <td data-label="来室予定" style={{ fontWeight: 700 }}>{n(visit.waiting_count)}人</td>
                    <td data-label="支払い済み">{n(visit.paid_count)}人</td>
                    <td data-label="期限切れ">{n(visit.expired_count)}人</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
