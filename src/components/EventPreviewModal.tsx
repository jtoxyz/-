'use client';

import React, { useEffect } from 'react';
import DOMPurify from 'isomorphic-dompurify';
import { marked } from 'marked';
import { parseShortcodes } from '@/lib/parseShortcodes';

interface EventPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  formData: {
    title: string;
    description: string;
    slotRows: Array<{
      id: string;
      label: string;
      date: string;
      startTime: string;
      endTime: string;
      capacity: number;
      totalCapacity: number;
      isEnabled: boolean;
      isReservationEnabled: boolean;
      isWalkinEnabled: boolean;
      isTicketUseEnabled: boolean;
      reservationStartsAt: string;
      reservationEndsAt: string;
      walkinStartsAt: string;
      walkinEndsAt: string;
      ticketUseStartsAt: string;
      ticketUseEndsAt: string;
    }>;
    postReservationNotes: string;
  };
}

export default function EventPreviewModal({ isOpen, onClose, formData }: EventPreviewModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 99999,
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: '800px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--card-bg)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--card-border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '12px',
            background: 'none',
            border: 'none',
            fontSize: '1.5rem',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            lineHeight: 1,
            zIndex: 10,
          }}
          title="閉じる"
        >
          ✕
        </button>

        <div style={{ background: '#fef3c7', color: '#92400e', padding: '12px 20px', textAlign: 'center', fontWeight: 'bold', borderBottom: '1px solid #fcd34d', borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)' }}>
          👁 プレビューモード — この内容はまだ保存されていません
        </div>

        <div style={{ padding: '30px 20px' }}>
          <div style={{ marginBottom: '20px' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              ← 一覧に戻る
            </span>
          </div>

          <h1 style={{ fontSize: '1.75rem', marginBottom: '12px', color: 'var(--text-primary)' }}>{formData.title || '（未入力の企画名）'}</h1>
          
          {formData.description ? (
            <div
              style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '24px' }}
              className="prose prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(parseShortcodes(formData.description), { breaks: true }) as string, { ADD_ATTR: ['style'] }) }}
            />
          ) : (
            <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '24px' }}>（企画説明文は設定されていません）</p>
          )}

          <div style={{ display: 'grid', gap: '16px', marginBottom: '40px' }}>
            {formData.slotRows.filter(s => s.isEnabled).map((slot, index) => (
              <div key={slot.id} className="glass-card" style={{ padding: '16px', background: 'var(--card-bg)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                      {slot.label || `開催枠 ${index + 1}`}
                    </h3>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      開催日時: {slot.date} {slot.startTime} 〜 {slot.endTime}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {slot.isReservationEnabled && (
                      <span className="badge" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>
                        予約券 (定員: {slot.capacity})
                      </span>
                    )}
                    {slot.isWalkinEnabled && (
                      <span className="badge" style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--card-border)' }}>
                        当日券
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {slot.isReservationEnabled && (
                    <button
                      className="btn btn-primary"
                      disabled
                      title="プレビューモードでは操作できません"
                      style={{ opacity: 0.5, cursor: 'not-allowed' }}
                    >
                      予約する
                    </button>
                  )}
                </div>
              </div>
            ))}
            {formData.slotRows.filter(s => s.isEnabled).length === 0 && (
              <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>（有効な開催枠がありません）</p>
            )}
          </div>

          {formData.postReservationNotes && (
            <div className="glass-card" style={{ padding: '20px', background: 'var(--card-bg)' }}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--text-primary)' }}>予約完了後の注意事項</h3>
              <div
                className="prose prose-sm max-w-none"
                style={{ color: 'var(--text-secondary)' }}
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(marked.parse(parseShortcodes(formData.postReservationNotes), { breaks: true }) as string, { ADD_ATTR: ['style'] }) }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
