'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

interface TicketDetails {
  reservation_id: string;
  student_name: string;
  student_number: string;
  status: 'reserved' | 'used' | 'cancelled';
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  public_token: string;
  used_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  event_id: string;
  event_title: string;
  event_description: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  use_starts_at: string | null;
  use_ends_at: string | null;
  slot_id: string | null;
  slot_label: string | null;
  slot_starts_at: string | null;
  slot_ends_at: string | null;
  slot_reservation_starts_at: string | null;
  slot_reservation_ends_at: string | null;
  slot_ticket_use_starts_at: string | null;
  slot_ticket_use_ends_at: string | null;
  slot_walkin_starts_at: string | null;
  slot_walkin_ends_at: string | null;
  slot_is_reservation_enabled: boolean;
  slot_is_ticket_use_enabled: boolean;
  slot_is_walkin_enabled: boolean;
  // Backwards compat aliases
  slot_reservation_use_starts_at: string | null;
  slot_reservation_use_ends_at: string | null;
  slot_walkin_use_starts_at: string | null;
  slot_walkin_use_ends_at: string | null;
  ticket_enabled: boolean;
  use_button_enabled: boolean;
  survey_after_reservation_enabled: boolean;
  survey_after_reservation_url: string | null;
  survey_after_reservation_message: string | null;
  survey_after_use_enabled: boolean;
  survey_after_use_url: string | null;
  survey_after_use_message: string | null;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '制限なし';
  const date = new Date(dateStr);
  return date.toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }) + ` (${['日', '月', '火', '水', '木', '金', '土'][date.getDay()]})`;
}

function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

export default function TicketPage({ params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = use(params);
  const [ticket, setTicket] = useState<TicketDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal flow
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Live clock
  const [currentTime, setCurrentTime] = useState<string>('');

  // Fetch ticket details
  useEffect(() => {
    async function fetchTicket() {
      try {
        const { data, error } = await supabase.rpc('get_ticket', {
          p_public_token: publicToken,
        });

        if (error || !data || data.length === 0) {
          setError('チケットが見つかりません。URLが正しいかご確認ください。');
          setLoading(false);
          return;
        }

        setTicket(data[0] as TicketDetails);
      } catch (err) {
        console.error('Error fetching ticket:', err);
        setError('データの読み込みに失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchTicket();
  }, [publicToken]);

  // Clock ticking handler
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          weekday: 'short',
        }) +
          ' ' +
          now.toLocaleTimeString('ja-JP', {
            hour12: false,
          })
      );
    }, 1000);

    // Initial run
    const now = new Date();
    setCurrentTime(
      now.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
      }) +
        ' ' +
        now.toLocaleTimeString('ja-JP', {
          hour12: false,
        })
    );

    return () => clearInterval(timer);
  }, []);

  const handleUseTicket = async () => {
    if (!ticket) return;
    setError(null);
    setUpdating(true);
    setShowConfirmModal(false);

    try {
      const { data, error: rpcError } = await supabase.rpc('use_ticket', {
        p_public_token: publicToken,
      });

      if (rpcError) {
        setError(rpcError.message || 'チケットの使用処理に失敗しました。');
        setUpdating(false);
        return;
      }

      // Update state
      const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
      setTicket((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status: parsedData.status,
          used_at: parsedData.used_at,
        };
      });
    } catch (err) {
      console.error('Error updating ticket status:', err);
      setError('サーバー処理中にエラーが発生しました。');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
        <p style={{ color: 'var(--text-secondary)' }}>チケットを読み込んでいます...</p>
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <div className="glass-card text-center" style={{ padding: '40px 20px' }}>
        <div className="error-banner" style={{ display: 'inline-flex', marginBottom: '24px' }}>
          <span>⚠️</span>
          <div>{error}</div>
        </div>
        <div>
          <Link href="/">
            <button className="btn btn-secondary btn-sm">ホームに戻る</button>
          </Link>
        </div>
      </div>
    );
  }

  if (!ticket) return null;

  const isReserved = ticket.status === 'reserved';
  const isUsed = ticket.status === 'used';
  const isCancelled = ticket.status === 'cancelled';

  // Determine if Use Button should be shown
  const showUseButton = isReserved && ticket.ticket_enabled && ticket.use_button_enabled;

  // Survey variables
  const showReservationSurvey =
    isReserved &&
    ticket.survey_after_reservation_enabled &&
    isValidUrl(ticket.survey_after_reservation_url);

  const showUseSurvey =
    isUsed &&
    ticket.survey_after_use_enabled &&
    isValidUrl(ticket.survey_after_use_url);

  return (
    <div className="ticket-container">
      <div style={{ marginBottom: '20px', width: '100%' }}>
        <Link href="/" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          ← 企画一覧へ戻る
        </Link>
      </div>

      {error && (
        <div className="error-banner" style={{ width: '100%' }}>
          <span>⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {/* Ticket Wrapper */}
      <div style={{ width: '100%', marginBottom: '24px' }}>
        {/* Banner */}
        {isReserved && (
          ticket.ticket_type === 'walkin' ? (
            <div className="ticket-status-banner unused" style={{ background: 'linear-gradient(135deg, var(--color-warning) 0%, #d97706 100%)', boxShadow: '0 4px 20px rgba(245, 158, 11, 0.3)' }}>
              当日券 (未使用)
            </div>
          ) : (
            <div className="ticket-status-banner unused">
              予約券 (未使用)
            </div>
          )
        )}
        {isUsed && (
          <div className="ticket-status-banner used">
            使用済み ({ticket.ticket_type === 'walkin' ? '当日券' : '予約券'})
          </div>
        )}
        {isCancelled && (
          <div className="ticket-status-banner cancelled">
            キャンセル済み ({ticket.ticket_type === 'walkin' ? '当日券' : '予約券'})
          </div>
        )}

        {/* Body */}
        <div className="ticket-body">
          <div className="ticket-detail-layout">
            {/* Info Column */}
            <div className="ticket-info-section">
              <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              企画名
            </span>
            <h2 style={{ fontSize: '1.4rem', color: '#fff', marginTop: '4px' }}>
              {ticket.event_title}
            </h2>
          </div>

          {ticket.slot_label && (
            <div style={{ textAlign: 'center', marginBottom: '16px', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>開催枠</span>
              <div style={{ color: '#fff', marginTop: '2px' }}>{ticket.slot_label}</div>
              <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                {formatDateTime(ticket.slot_starts_at)} 〜 {formatDateTime(ticket.slot_ends_at)}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', margin: '20px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px' }}>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>氏名</span>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', marginTop: '2px' }}>{ticket.student_name}</div>
            </div>
            <div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>学籍番号</span>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: '#fff', marginTop: '2px' }}>{ticket.student_number}</div>
            </div>
          </div>
        </div>

        {/* Action/Operation Column */}
        <div className="ticket-action-section">
          {/* Use window info - uses unified slot_ticket_use_starts_at/ends_at for both reservation and walkin */}
          {ticket.ticket_enabled && isReserved && (() => {
            // Both reservation tickets and walkin tickets use the same slot-level ticket_use window
            const effectiveStart = ticket.slot_ticket_use_starts_at;
            const effectiveEnd = ticket.slot_ticket_use_ends_at;
            const isEnabled = ticket.slot_is_ticket_use_enabled !== false;

            if (!effectiveStart && !effectiveEnd) return null;

            const now = new Date();
            const beforeWindow = effectiveStart && now < new Date(effectiveStart);
            const afterWindow = effectiveEnd && now > new Date(effectiveEnd);
            const isWalkin = ticket.ticket_type === 'walkin';

            return (
              <div style={{
                textAlign: 'center',
                marginBottom: '16px',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: !isEnabled || beforeWindow || afterWindow
                  ? 'rgba(239, 68, 68, 0.08)'
                  : 'rgba(99, 102, 241, 0.08)',
                border: !isEnabled || beforeWindow || afterWindow
                  ? '1px solid rgba(239, 68, 68, 0.2)'
                  : '1px solid rgba(99, 102, 241, 0.2)',
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {isWalkin ? '当日券' : '予約券'} 使用可能時間
                </span>
                <div style={{ color: '#c7d2fe', marginTop: '4px', fontSize: '0.9rem', fontWeight: 600 }}>
                  {formatDateTime(effectiveStart)} 〜 {formatDateTime(effectiveEnd)}
                </div>
                {!isEnabled && (
                  <div style={{ color: 'var(--color-danger)', fontSize: '0.78rem', marginTop: '4px' }}>
                    チケット使用は現在無効に設定されています。
                  </div>
                )}
                {isEnabled && beforeWindow && (
                  <div style={{ color: 'var(--color-warning)', fontSize: '0.78rem', marginTop: '4px' }}>
                    このチケットは企画当日の指定時間のみ使用できます。
                  </div>
                )}
                {isEnabled && afterWindow && (
                  <div style={{ color: 'var(--color-danger)', fontSize: '0.78rem', marginTop: '4px' }}>
                    使用可能時間は終了しました。
                  </div>
                )}
              </div>
            );
          })()}



          {/* Ticket code displaying if ticket feature is enabled */}
          {ticket.ticket_enabled && (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>チケット引き換えコード</span>
              <div className="ticket-code-display">{ticket.ticket_code}</div>
            </div>
          )}

          {/* Used timestamp */}
          {isUsed && ticket.used_at && (
            <div style={{ background: 'var(--color-danger-bg)', border: '1px solid var(--color-danger-border)', padding: '12px', borderRadius: 'var(--radius-md)', textAlign: 'center', margin: '16px 0' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-danger)', fontWeight: 700 }}>
                使用済み処理時刻
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', marginTop: '4px' }}>
                {formatDateTime(ticket.used_at)}
              </div>
            </div>
          )}

          {/* Live verification clock */}
          <div className="live-clock-box">
            <span className="live-clock-time">{currentTime}</span>
            <div className="live-clock-indicator">
              画面確認用リアルタイムクロック
            </div>
          </div>

          {isUsed && (
            <div style={{ textAlign: 'center', margin: '16px 0', padding: '0 8px' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--color-danger, #f43f5e)', textShadow: '0 0 10px rgba(244,63,94,0.2)' }}>
                ▲ この画面を店員・スタッフに見せてください
              </div>
            </div>
          )}

          {/* Action buttons */}
          {showUseButton && (
            <div style={{ marginTop: '24px' }}>
              <button
                className="btn btn-primary"
                style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)' }}
                onClick={() => setShowConfirmModal(true)}
                disabled={updating}
              >
                {updating ? '処理中...' : '使用する (スタッフの前で押してください)'}
              </button>
            </div>
          )}

          {/* Instructions */}
          {isReserved && ticket.ticket_enabled && (
            <div style={{ marginTop: '20px', padding: '12px', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.02)', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--color-warning)', display: 'block', marginBottom: '4px' }}>⚠️ 注意事項</strong>
              • チケット引換の際は、スタッフが指示するまで「使用する」ボタンを押さないでください。<br />
              • スクリーンショットでは入場・引換できません（画面上の時計が動いている必要があります）。
            </div>
          )}
            </div>
          </div>
        </div>
      </div>

      {/* Reservation Survey Button */}
      {showReservationSurvey && (
        <div className="survey-banner" style={{ width: '100%' }}>
          <div className="survey-message">
            {ticket.survey_after_reservation_message || '今後の企画改善のため、アンケートにご協力ください。'}
          </div>
          <a
            href={ticket.survey_after_reservation_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{ width: 'auto' }}
          >
            アンケートに回答する (外部サイト)
          </a>
        </div>
      )}

      {/* Usage Survey Button */}
      {showUseSurvey && (
        <div className="survey-banner" style={{ width: '100%', borderColor: 'var(--color-success-border)' }}>
          <div className="survey-message">
            {ticket.survey_after_use_message || 'ご参加ありがとうございました。今後の企画改善のため、アンケートにご協力ください。'}
          </div>
          <a
            href={ticket.survey_after_use_url!}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-sm"
            style={{ background: 'linear-gradient(135deg, var(--color-success) 0%, #059669 100%)', width: 'auto' }}
          >
            アンケートに回答する (外部サイト)
          </a>
        </div>
      )}

      {/* Double confirmation modal */}
      {showConfirmModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 className="modal-title">
              <span>⚠️</span> 使用の最終確認
            </h3>
            <div className="modal-body">
              <strong>店員・スタッフの目の前で使用してください。</strong>
              <br /><br />
              一度使用済みに変更すると、元に戻すことはできません。よろしいですか？
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowConfirmModal(false)}
                disabled={updating}
              >
                キャンセル
              </button>
              <button
                className="btn btn-danger"
                onClick={handleUseTicket}
                disabled={updating}
              >
                はい、使用します
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
