'use client';

import { useCallback, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useLoadEffect } from '@/hooks/useLoadEffect';
import { isoToJstTime, todayJst } from '@/lib/jst';
import { getPaymentSummary } from '@/lib/staffPaymentRpc';
import { formatYenTotal, type PaymentSummary } from '@/lib/staffPaymentScan';

const muted = { color: 'var(--text-secondary)' } as const;

/**
 * 受付を閉めるときの照合。その日の係ごとの受領・取消と明細を出し、現金の合計と比べてもらう。
 * スタッフは今日の自分の分だけ（DB側でも制限）。管理者は全員分を見られ、日付も変えられる。
 */
export default function PaymentReconciliation({
  client,
  eventId,
  isAdmin,
  reloadKey = 0,
}: {
  client: SupabaseClient;
  eventId: string;
  isAdmin: boolean;
  /** 受付画面で受領・取消をしたら増やす。変わると読み直す */
  reloadKey?: number;
}) {
  const [date, setDate] = useState(() => todayJst());
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // スタッフは日付を送らない（DBが今日として扱う）
    const res = await getPaymentSummary(client, eventId, isAdmin ? date : undefined);
    setLoading(false);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    if (!res.data) {
      setError('集計を読み込めませんでした。');
      return;
    }
    setError(null);
    setSummary(res.data);
  }, [client, eventId, isAdmin, date]);

  useLoadEffect(() => load(), [load, reloadKey]);

  const counted = summary?.operators.filter((o) => o.operator_user_id !== null) ?? [];
  const sum = (key: 'received_count' | 'received_yen' | 'undone_count' | 'undone_yen') =>
    counted.reduce((total, o) => total + o[key], 0);

  return (
    <section aria-label="支払いの照合">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <h3 style={{ fontSize: '1.1rem' }}>照合（{summary?.date ?? (isAdmin ? date : '今日')}）</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {isAdmin && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
              日付
              <input
                type="date"
                className="form-input"
                value={date}
                onChange={(e) => setDate(e.target.value || todayJst())}
                style={{ width: 'auto', padding: '6px 10px' }}
              />
            </label>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={15} aria-hidden="true" />{loading ? '読み込み中…' : '更新'}
          </button>
        </div>
      </div>

      <p style={{ fontWeight: 700, marginBottom: 12 }}>現金の合計がこの金額と合うか確認してください</p>

      {error && (
        <div className="error-banner" role="alert">
          <TriangleAlert size={20} aria-hidden="true" style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {!summary ? (
        !error && <div style={{ textAlign: 'center', padding: 16 }} role="status"><div className="loading-spinner" /></div>
      ) : (
        <>
          <div className="admin-table-container" style={{ marginBottom: 16 }}>
            <table className="admin-table">
              <thead>
                <tr><th>係</th><th>受領</th><th>取消</th><th>差し引き</th></tr>
              </thead>
              <tbody>
                {summary.operators.length === 0 && (
                  <tr><td colSpan={4} style={muted}>この日の受領はありません。</td></tr>
                )}
                {summary.operators.map((o) => (
                  <tr key={o.operator_user_id ?? 'none'} style={o.operator_user_id === null ? muted : undefined}>
                    <td>{o.operator_name ?? '（名前なし）'}</td>
                    <td>{o.received_count}件 {formatYenTotal(o.received_yen)}</td>
                    <td>{o.undone_count}件 {formatYenTotal(o.undone_yen)}</td>
                    <td style={{ fontWeight: 700 }}>{o.net_count}件 {formatYenTotal(o.net_yen)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ fontWeight: 800 }}>
                  <td>合計</td>
                  <td>{sum('received_count')}件 {formatYenTotal(sum('received_yen'))}</td>
                  <td>{sum('undone_count')}件 {formatYenTotal(sum('undone_yen'))}</td>
                  <td style={{ fontSize: '1.1rem' }}>{summary.total.net_count}件 {formatYenTotal(summary.total.net_yen)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {summary.operators.some((o) => o.operator_user_id === null) && (
            <p style={{ ...muted, fontSize: '0.82rem', marginTop: -8, marginBottom: 16 }}>
              「（記録外の取消）」は受領の記録がない支払いの取消です。合計には含めていません。
            </p>
          )}

          <h4 style={{ fontSize: '1rem', marginBottom: 8 }}>明細</h4>
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr><th>時刻</th><th>氏名</th><th>学籍番号</th><th>券種</th><th>金額</th><th>受領/取消</th><th>操作した人</th></tr>
              </thead>
              <tbody>
                {summary.items.length === 0 && (
                  <tr><td colSpan={7} style={muted}>明細はありません。</td></tr>
                )}
                {summary.items.map((i) => (
                  <tr
                    key={i.receipt_id}
                    style={i.reversed ? { textDecoration: 'line-through', color: 'var(--text-secondary)' } : undefined}
                  >
                    <td>{isoToJstTime(i.created_at)}</td>
                    <td>{i.student_name ?? ''}</td>
                    <td>{i.student_number ?? ''}</td>
                    <td>{i.ticket_option_label ?? ''}</td>
                    <td>{formatYenTotal(i.amount_yen)}</td>
                    <td style={{ color: i.action === 'undone' ? 'var(--color-danger)' : undefined, fontWeight: 700 }}>
                      {i.action === 'received' ? '受領' : '取消'}
                      {i.reversed && <span className="visually-hidden">（取り消し済み）</span>}
                    </td>
                    <td>{i.operator_name ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
