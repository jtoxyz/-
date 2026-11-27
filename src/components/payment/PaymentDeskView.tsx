'use client';

import { TriangleAlert, X } from 'lucide-react';
import { formatJstDateTime, isoToJstTime } from '@/lib/jst';
import { formatVisitSlot, visitSlotPlace } from '@/lib/paymentVisit';
import {
  alreadyPaidMessage,
  isOutsideVisitWindows,
  pendingVisitWindows,
  unavailableMessage,
  type DeskView,
} from '@/lib/staffPaymentScan';
import { formatYen } from '@/lib/ticketOption';

// 受付画面（PaymentReceiveDesk）の表示部分。状態は持たない。

export const NOT_A_QR_MESSAGE = 'QRコードをスキャナーで読んでください（学籍番号・氏名では探せません）';

export type DeskNotice = { tone: 'success' | 'danger' | 'warning'; text: string; sub?: string };

/** 係が一目で分かるよう、緑・赤はテーマに関係なく濃い色で塗る（/pay の結果表示と同じ色） */
export function DeskBand({ tone, text, sub }: DeskNotice) {
  const solid = tone === 'success' ? '#16a34a' : tone === 'danger' ? '#dc2626' : null;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      style={{
        background: solid ?? 'var(--color-warning-bg)',
        border: solid ? 'none' : '1px solid var(--color-warning-border)',
        color: solid ? '#ffffff' : 'var(--color-warning)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 18px',
        marginBottom: 10,
      }}
    >
      <div style={{ fontSize: '1.3rem', fontWeight: 900, lineHeight: 1.4 }}>{text}</div>
      {sub && <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} style={{ marginTop: 4 }}>
      <X size={15} aria-hidden="true" />閉じる
    </button>
  );
}

/** QRを読んだ結果。未払いなら受け取りボタンを出す */
export function DeskViewPanel({
  view,
  scannedAt,
  receiving,
  onReceive,
  onClose,
}: {
  view: DeskView;
  /** 読んだ時刻（ms）。予定の時間外かどうかの判定に使う */
  scannedAt: number;
  receiving: boolean;
  onReceive: () => void;
  onClose: () => void;
}) {
  switch (view.kind) {
    case 'pending': {
      const rows = view.reservations.filter((r) => view.reservationIds.includes(r.reservation_id));
      const windows = pendingVisitWindows(view.reservations);
      const outside = isOutsideVisitWindows(windows, scannedAt);
      return (
        <div className="glass-card" style={{ margin: 0, border: '3px solid var(--color-primary)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
            <strong style={{ fontSize: 'clamp(1.7rem, 5vw, 2.3rem)', lineHeight: 1.2 }}>{view.studentName}</strong>
            <span style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.04em' }}>{view.studentNumber}</span>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.2rem', marginBottom: 8 }}>
            <tbody>
              {rows.map((r) => (
                <tr key={r.reservation_id} style={{ borderBottom: '1px solid var(--card-border)' }}>
                  <td style={{ padding: '6px 0', fontWeight: 700 }}>{r.ticket_option_label ?? '券種なし'}</td>
                  <td style={{ padding: '6px 8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    {r.slot_label ?? ''}{r.slot_starts_at ? `（${formatJstDateTime(r.slot_starts_at)}）` : ''}
                  </td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 800, whiteSpace: 'nowrap' }}>{formatYen(r.amount_yen)}</td>
                </tr>
              ))}
              {rows.length > 1 && (
                <tr>
                  <td colSpan={2} style={{ padding: '6px 0', fontWeight: 800 }}>合計</td>
                  <td style={{ padding: '6px 0', textAlign: 'right', fontWeight: 900, whiteSpace: 'nowrap' }}>{formatYen(view.totalYen)}</td>
                </tr>
              )}
            </tbody>
          </table>

          {view.paidCount > 0 && (
            <p style={{ fontWeight: 700, marginBottom: 6 }}>ほかに支払い済みが {view.paidCount} 件あります</p>
          )}
          {windows.length > 0 && (
            <p style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>
              支払い受付枠：{windows.map((w) => `${formatVisitSlot(w)}（${visitSlotPlace(w)}）`).join('、')}
            </p>
          )}
          {outside && <DeskBand tone="warning" text="予定の時間外です（受け取りはできます）" />}

          <button
            type="button"
            className="btn btn-primary"
            onClick={onReceive}
            disabled={receiving}
            style={{ width: '100%', fontSize: '1.6rem', fontWeight: 900, padding: '18px 16px', marginTop: 6, marginBottom: 8 }}
          >
            {receiving ? '受領しています…' : `${formatYen(view.totalYen)} 受け取った`}
          </button>
          <CloseButton onClose={onClose} />
        </div>
      );
    }
    case 'already_paid':
      return (
        <div>
          <DeskBand
            tone="danger"
            text={alreadyPaidMessage({
              byMe: view.byMe,
              time: isoToJstTime(view.receivedAt ?? view.paidAt),
              receivedByName: view.receivedByName,
            })}
            sub={`${view.studentName}　${view.studentNumber}`}
          />
          <CloseButton onClose={onClose} />
        </div>
      );
    case 'unavailable':
      return (
        <div>
          <DeskBand tone="danger" text={unavailableMessage(view.reason)} sub={view.studentName} />
          <CloseButton onClose={onClose} />
        </div>
      );
    case 'other_event':
    case 'not_found':
    case 'not_a_qr':
      return (
        <div>
          <div className="error-banner" role="alert" style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 10 }}>
            <TriangleAlert size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>
              {view.kind === 'other_event'
                ? `この予約は『${view.eventTitle}』の予約です。正しい予約のQRを出してもらってください`
                : view.kind === 'not_found'
                  ? 'この企画の予約が見つかりません'
                  : NOT_A_QR_MESSAGE}
            </span>
          </div>
          <CloseButton onClose={onClose} />
        </div>
      );
  }
}
