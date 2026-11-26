'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Camera, ClipboardList, ScanLine } from 'lucide-react';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { isoToJstTime } from '@/lib/jst';
import { findPaymentTarget, getPaymentSummary, receivePayment, undoPayment } from '@/lib/staffPaymentRpc';
import {
  alreadyPaidMessage,
  deskTodayFromSummary,
  deskViewFromFind,
  dropMissed,
  formatYenTotal,
  looksLikeImeInput,
  nextMissedList,
  reservationTokenFromScan,
  sameReservationIds,
  type DeskView,
  type MissedEntry,
  type PaymentSummary,
  type ReceiveResult,
} from '@/lib/staffPaymentScan';
import { formatYen } from '@/lib/ticketOption';
import { DeskBand, DeskViewPanel, NOT_A_QR_MESSAGE, type DeskNotice } from './PaymentDeskView';
import PaymentReconciliation from './PaymentReconciliation';
import QrCameraScanner from './QrCameraScanner';

// QrCameraScanner はこの2つが変わるとカメラを起動し直すので、固定の文字列にしておく
const CAMERA_FALLBACK_HINT = '受付のノートPCでUSBスキャナーを使って読んでください。';
const CAMERA_REJECT_HINT = '予約のQRコードではありません。学生の予約画面に出ているQRコードを写してください。';
const IME_MESSAGE = '日本語入力がオンになっています。半角英数に切り替えてから、もう一度読んでください';

type Shown = { view: DeskView; scannedAt: number };
type SummaryItem = PaymentSummary['items'][number];

const hhmm = (ms: number) => isoToJstTime(new Date(ms).toISOString());
/** QRを読んだ時刻。検索結果が返ったとき（イベント処理の中）だけ呼ぶ */
const scannedNow = () => Date.now();

function receiveNotices(result: ReceiveResult, studentName: string): DeskNotice[] {
  const notices: DeskNotice[] = [];
  if (result.received_count > 0) {
    notices.push({ tone: 'success', text: `受領しました ${formatYen(result.received_total_yen)}`, sub: studentName });
  }
  for (const paid of result.already_paid) {
    notices.push({
      tone: 'danger',
      text: alreadyPaidMessage({ byMe: false, time: isoToJstTime(paid.paid_at), receivedByName: paid.received_by_name }),
      sub: studentName,
    });
  }
  if (result.unavailable.length > 0) {
    notices.push({
      tone: 'danger',
      text: `${result.unavailable.length}件は期限切れ・キャンセルのため受領できませんでした。管理者に回してください`,
      sub: studentName,
    });
  }
  if (notices.length === 0) notices.push({ tone: 'danger', text: '受領できた予約はありませんでした', sub: studentName });
  return notices;
}

/**
 * 受付の係が、学生の予約QRをUSBスキャナー（予備でカメラ）で読み、現金を受け取ったら支払い済みにする画面。
 * スキャナーは「文字＋Enter」を打ち込むので、入力欄にフォーカスを置き続ける。
 */
export default function PaymentReceiveDesk({
  client,
  eventId,
  isAdmin,
  initialQuery,
}: {
  client: SupabaseClient;
  eventId: string;
  isAdmin: boolean;
  initialQuery?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 検索・受領・取消の最中は次の入力を無視する（state だと連続入力の間に反映が間に合わない）
  const busy = useRef(false);
  const shownRef = useRef<Shown | null>(null);
  const initialQueryDone = useRef(false);

  const [query, setQuery] = useState('');
  const [working, setWorking] = useState<'search' | 'receive' | 'undo' | null>(null);
  const [shown, setShownState] = useState<Shown | null>(null);
  const [notices, setNotices] = useState<DeskNotice[]>([]);
  const [missed, setMissed] = useState<MissedEntry[]>([]);
  const [uid, setUid] = useState<string | null>(null);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [reconciliationOpen, setReconciliationOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const setShown = (next: Shown | null) => {
    shownRef.current = next;
    setShownState(next);
  };
  // 描画が終わってから戻す（ボタンやダイアログからフォーカスを取り返す）
  const focusInput = () => window.setTimeout(() => inputRef.current?.focus(), 0);

  const loadSummary = useCallback(async () => {
    const res = await getPaymentSummary(client, eventId);
    if (res.error !== null) {
      setSummaryError(res.error);
      return;
    }
    setSummaryError(null);
    setSummary(res.data ?? null);
  }, [client, eventId]);

  const afterChange = () => {
    void loadSummary();
    setReloadKey((k) => k + 1);
  };

  const runQuery = async (raw: string) => {
    if (busy.current) return;
    const token = reservationTokenFromScan(raw);
    if (!token) {
      setNotices([{ tone: 'danger', text: looksLikeImeInput(raw) ? IME_MESSAGE : NOT_A_QR_MESSAGE }]);
      focusInput();
      return;
    }
    busy.current = true;
    setWorking('search');
    const res = await findPaymentTarget(client, eventId, token);
    busy.current = false;
    setWorking(null);
    focusInput();
    if (res.error !== null || !res.data) {
      setNotices([{ tone: 'danger', text: res.error ?? '予約を探せませんでした。もう一度読んでください' }]);
      return;
    }
    const view = deskViewFromFind(res.data);
    const previous = shownRef.current;
    setMissed((list) => nextMissedList(list, previous, view));
    setNotices([]);
    setShown({ view, scannedAt: scannedNow() });
  };

  const receive = async (reservationIds: string[], studentName: string) => {
    if (busy.current) return;
    busy.current = true;
    setWorking('receive');
    const res = await receivePayment(client, reservationIds);
    busy.current = false;
    setWorking(null);
    focusInput();
    if (res.error !== null) {
      // 表示はそのまま残し、もう一度押せるようにする
      setNotices([{ tone: 'danger', text: res.error, sub: studentName }]);
      return;
    }
    if (!res.data) {
      setNotices([{ tone: 'danger', text: '受領の結果を確認できませんでした。照合で確認してください', sub: studentName }]);
      afterChange();
      return;
    }
    setNotices(receiveNotices(res.data, studentName));
    setMissed((list) => dropMissed(list, reservationIds));
    const current = shownRef.current?.view;
    if (current?.kind === 'pending' && sameReservationIds(current.reservationIds, reservationIds)) setShown(null);
    afterChange();
  };

  const undo = async (item: SummaryItem) => {
    if (busy.current) return;
    const name = item.student_name ?? '（氏名なし）';
    if (!window.confirm(`${name} ${formatYen(item.amount_yen)} の受領を取り消します。よろしいですか？`)) {
      focusInput();
      return;
    }
    busy.current = true;
    setWorking('undo');
    const res = await undoPayment(client, item.reservation_id);
    busy.current = false;
    setWorking(null);
    focusInput();
    if (res.error !== null) {
      setNotices([{ tone: 'danger', text: res.error, sub: name }]);
      return;
    }
    const next: DeskNotice[] = [
      { tone: 'warning', text: `受領を取り消しました ${formatYen(res.data?.amount_yen ?? item.amount_yen)}`, sub: name },
    ];
    if (res.data?.will_expire) {
      next.push({ tone: 'danger', text: '支払い期限を過ぎているため、1分以内に自動キャンセルされます', sub: name });
    }
    setNotices(next);
    // 「支払い済み」の表示は取消で古くなるので消す（未払いの人の表示は残す）
    if (shownRef.current?.view.kind === 'already_paid') setShown(null);
    afterChange();
  };

  const submit = (text: string) => {
    setQuery('');
    if (!text.trim()) return;
    void runQuery(text);
  };

  const closeResult = () => {
    setShown(null);
    setNotices([]);
    focusInput();
  };

  // 開いたら入力欄にフォーカス
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useLoadEffect(async () => {
    const { data } = await client.auth.getUser();
    setUid(data.user?.id ?? null);
  }, [client]);

  useLoadEffect(() => loadSummary(), [loadSummary]);

  // /staff?r=... から開いたときは、最初に1回だけそのQRで探す
  useLoadEffect(() => {
    if (initialQueryDone.current || !initialQuery) return;
    initialQueryDone.current = true;
    return runQuery(initialQuery);
  }, []);

  const today = deskTodayFromSummary(summary, uid, isAdmin);
  const searching = working === 'search';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginBottom: 14 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <ScanLine
            size={22}
            aria-hidden="true"
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}
          />
          <input
            ref={inputRef}
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="form-input"
            aria-label="受付で見せるQR（スキャナーで読む）"
            placeholder="QRをスキャナーで読んでください"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submit(e.currentTarget.value);
            }}
            style={{ fontSize: '1.15rem', padding: '14px 14px 14px 44px', width: '100%' }}
          />
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setCameraOpen(true)} style={{ whiteSpace: 'nowrap' }}>
          <Camera size={18} aria-hidden="true" />読む
        </button>
      </div>

      <div aria-live="polite">
        {searching && (
          <p role="status" style={{ color: 'var(--text-secondary)', marginBottom: 10 }}>探しています…</p>
        )}
        {notices.map((notice, i) => (
          <DeskBand key={`${i}-${notice.text}`} {...notice} />
        ))}
      </div>

      {shown && (
        <div style={{ marginBottom: 16 }}>
          <DeskViewPanel
            view={shown.view}
            scannedAt={shown.scannedAt}
            receiving={working === 'receive'}
            onReceive={() => {
              if (shown.view.kind === 'pending') void receive(shown.view.reservationIds, shown.view.studentName);
            }}
            onClose={closeResult}
          />
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--card-border)', paddingTop: 14, marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ fontSize: '1.1rem' }}>
            今日の受付：<strong>{today.netCount}件</strong>　<strong>{formatYenTotal(today.netYen)}</strong>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            aria-expanded={reconciliationOpen}
            onClick={() => setReconciliationOpen((open) => !open)}
          >
            <ClipboardList size={15} aria-hidden="true" />{reconciliationOpen ? '照合を閉じる' : '照合を見る'}
          </button>
        </div>
        {summaryError && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: '0.88rem', marginBottom: 8 }}>
            集計を読み込めませんでした：{summaryError}
          </p>
        )}

        {(missed.length > 0 || today.recent.length > 0) && (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }} aria-label="直前の受付">
            {missed.map((m) => (
              <li
                key={`missed-${m.key}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 10px',
                  borderRadius: 'var(--radius-md)', background: 'var(--color-warning-bg)', border: '1px solid var(--color-warning-border)',
                }}
              >
                <strong style={{ color: 'var(--color-warning)' }}>未受領（読んだだけ）</strong>
                <span>{m.studentName}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{m.studentNumber}</span>
                <span style={{ color: 'var(--text-secondary)' }}>{hhmm(m.scannedAt)}</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  style={{ marginLeft: 'auto' }}
                  disabled={working !== null}
                  onClick={() => void receive(m.reservationIds, m.studentName)}
                >
                  {formatYen(m.totalYen)} 受け取った
                </button>
              </li>
            ))}
            {today.recent.map((item) => (
              <li
                key={item.receipt_id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '6px 10px', fontSize: '0.95rem' }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>直前：</span>
                <span style={item.reversed ? { textDecoration: 'line-through', color: 'var(--text-secondary)' } : undefined}>
                  {item.student_name ?? '（氏名なし）'} {formatYenTotal(item.amount_yen)}{' '}
                  <span style={{ color: item.action === 'undone' ? 'var(--color-danger)' : undefined }}>
                    {item.action === 'received' ? '受領' : '取消'}
                  </span>{' '}
                  {isoToJstTime(item.created_at)}
                </span>
                {item.reversed && <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>（取り消し済み）</span>}
                {item.action === 'received' && !item.reversed && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: 'auto' }}
                    disabled={working !== null}
                    onClick={() => void undo(item)}
                  >
                    取消
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {reconciliationOpen && (
        <div style={{ marginTop: 20 }}>
          <PaymentReconciliation client={client} eventId={eventId} isAdmin={isAdmin} reloadKey={reloadKey} />
        </div>
      )}

      {cameraOpen && (
        <QrCameraScanner
          title="学生の予約画面のQRコードを枠の中に写してください"
          fallbackHint={CAMERA_FALLBACK_HINT}
          rejectHint={CAMERA_REJECT_HINT}
          ariaLabel="受付で見せるQRの読み取り"
          onDetect={(text) => {
            const ok = Boolean(reservationTokenFromScan(text));
            if (ok) {
              setCameraOpen(false);
              void runQuery(text);
            }
            return ok;
          }}
          onClose={() => {
            setCameraOpen(false);
            focusInput();
          }}
        />
      )}
    </div>
  );
}
