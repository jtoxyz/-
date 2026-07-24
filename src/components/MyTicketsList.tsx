'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { getSavedTokens, removeToken } from '@/lib/ticketCache';

interface CachedTicket {
  reservation_id: string;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  public_token: string;
  event_title: string;
  slot_label?: string | null;
  slot_ticket_use_ends_at?: string | null;
  slot_reservation_use_ends_at?: string | null;
  use_ends_at?: string | null;
}

// [重要度: 高]
// 支払期限・使用期限として表示する日時を、実行環境のタイムゾーンに左右されず日本時間で整形する。
// Asia/Tokyoを削除するとEdge Runtimeなどで9時間ずれて表示される可能性がある。
function formatDeadline(dateStr: string): string {
  const date = new Date(dateStr);
  const datePart = date.toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    weekday: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(date);
  const timePart = date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Tokyo',
  });
  return `${datePart}（${weekday}）${timePart}`;
}

// [重要度: 中]
// 現在時刻と期限の差から、利用者向けの支払期限メッセージを作成する表示用処理。
// 予約成立やチケット使用可否を確定する処理ではなく、最終判定はデータベース側の処理に従う。
function getDeadlineInfo(dateStr: string): {
  headline: string;
  detail: string;
  expired: boolean;
} {
  const deadline = new Date(dateStr);
  const now = new Date();
  const diffMs = deadline.getTime() - now.getTime();
  const detail = `${formatDeadline(dateStr)}までにお支払いください`;

  if (diffMs <= 0) {
    return {
      headline: '支払期限を過ぎています',
      detail,
      expired: true,
    };
  }

  // [重要度: 中]
  // 端数の時間が残っている場合も「あと1日」と表示するため切り上げで日数を算出する。
  const remainingDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  if (remainingDays <= 1) {
    return {
      headline: '支払期限は本日です',
      detail,
      expired: false,
    };
  }

  return {
    headline: `支払期限まであと${remainingDays}日`,
    detail,
    expired: false,
  };
}

export default function MyTicketsList() {
  const [tickets, setTickets] = useState<CachedTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadTickets() {
      // [重要度: 高]
      // このブラウザに保存された公開トークンだけを読み込み、利用者自身が取得したチケット一覧を復元する。
      // トークンはチケット画面への参照情報なので、ログや画面上へ不用意に追加表示しないこと。
      const tokens = getSavedTokens();
      if (tokens.length === 0) {
        setLoading(false);
        return;
      }

      try {
        // [重要度: 高]
        // 保存済みの各公開トークンをget_ticket RPCへ渡し、現在のチケット状態を取得する。
        // ブラウザ内の古い情報ではなく、予約・使用・キャンセル後の最新状態を表示するために必要。
        const ticketFetches = tokens.map(async (token: string) => {
          const { data, error } = await supabase.rpc('get_ticket', {
            p_public_token: token,
          });

          if (error || !data || data.length === 0) {
            // [重要度: 中]
            // RPC自体のエラーではなくチケットが存在しない場合のみ、無効になったトークンを端末キャッシュから除去する。
            // 一時的な通信エラー時に削除すると、正常なチケットが一覧から消えるため条件を変更しないこと。
            if (!error) removeToken(token);
            return null;
          }

          return data[0] as CachedTicket;
        });

        const fetchedTickets = await Promise.all(ticketFetches);
        const validTickets = fetchedTickets.filter((t: CachedTicket | null): t is CachedTicket => t !== null);
        // [重要度: 高]
        // キャンセル済みチケットは利用可能な一覧から除外する。
        // データベースから削除する処理ではなく、この画面に表示しないためのフィルタリングのみ。
        const activeTickets = validTickets.filter((t: CachedTicket) => t.status !== 'cancelled');
        setTickets(activeTickets);
      } catch (err) {
        console.error('Failed to load cached tickets:', err);
      } finally {
        setLoading(false);
      }
    }

    loadTickets();
  }, []);

  if (loading) {
    return <div className="loading-spinner" style={{ transform: 'scale(0.8)' }}></div>;
  }

  if (tickets.length === 0) {
    return null;
  }

  return (
    <div className="glass-card" style={{ borderColor: 'var(--color-primary-hover)', background: 'rgba(99, 102, 241, 0.05)' }}>
      <h3 style={{ marginBottom: '12px', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>🎟️</span> 予約済みのチケット一覧
      </h3>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
        このブラウザで予約したチケットです。タップしてチケット画面を表示できます。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {tickets.map((ticket) => {
          // [重要度: 高]
          // 新しい開催枠単位の期限を優先し、旧データとの互換用項目、企画全体の期限の順で補完する。
          // 古い予約データも表示できるようにしているため、後方互換項目を確認せず削除しないこと。
          const paymentDeadline =
            ticket.slot_ticket_use_ends_at ||
            ticket.slot_reservation_use_ends_at ||
            ticket.use_ends_at ||
            null;

          const deadline =
            ticket.status === 'reserved' &&
            ticket.ticket_type === 'reservation' &&
            paymentDeadline
              ? getDeadlineInfo(paymentDeadline)
              : null;

          return (
            <Link
              key={ticket.public_token}
              href={`/tickets/${ticket.public_token}`}
              style={{ display: 'block' }}
            >
              <div
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--card-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--color-primary)';
                  e.currentTarget.style.background = 'var(--card-bg)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--card-border)';
                  e.currentTarget.style.background = 'var(--card-bg)';
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', marginBottom: '2px' }}>
                    {ticket.event_title}
                  </div>
                  {ticket.slot_label && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '1px' }}>
                      📅 {ticket.slot_label}
                    </div>
                  )}
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    氏名: {ticket.student_name} / 学籍番号: {ticket.student_number}
                  </div>
                  {deadline && (
                    <div
                      style={{
                        marginTop: '9px',
                        paddingTop: '8px',
                        borderTop: '1px solid var(--card-border)',
                        lineHeight: 1.45,
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 800,
                          color: deadline.expired ? 'var(--color-danger)' : 'var(--color-warning)',
                        }}
                      >
                        ⏰ {deadline.headline}
                      </div>
                      <div style={{ marginTop: '2px', fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                        {deadline.detail}
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ flexShrink: 0 }}>
                  {ticket.status === 'used' ? (
                    <span className="badge badge-warning" style={{ fontSize: '0.7rem' }}>使用済み</span>
                  ) : ticket.ticket_type === 'walkin' ? (
                    <span className="badge" style={{ fontSize: '0.7rem', backgroundColor: 'var(--color-warning-bg)', color: 'var(--color-warning)', borderColor: 'var(--color-warning-border)' }}>当日券</span>
                  ) : (
                    <span className="badge" style={{ fontSize: '0.7rem', backgroundColor: 'var(--color-primary-glow)', color: 'var(--color-primary)', borderColor: 'var(--card-border-hover)' }}>予約券</span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}