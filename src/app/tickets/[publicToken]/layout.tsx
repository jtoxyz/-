'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type PaymentState = {
  payment_required: boolean;
  payment_status: 'not_required' | 'pending' | 'paid' | 'expired';
  payment_due_at: string | null;
  paid_at: string | null;
};

function formatJst(value: string | null) {
  if (!value) return '―';
  return new Date(value).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

function formatRemaining(dueAt: string | null, now: number) {
  if (!dueAt) return null;
  const remainingMs = new Date(dueAt).getTime() - now;
  if (remainingMs <= 0) return '支払期限を過ぎています';

  const totalSeconds = Math.floor(remainingMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `あと ${hours}時間 ${minutes}分 ${seconds}秒`;
  if (minutes > 0) return `あと ${minutes}分 ${seconds}秒`;
  return `あと ${seconds}秒`;
}

export default function TicketPaymentLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ publicToken: string }>;
}>) {
  const { publicToken } = use(params);
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    const load = async () => {
      const { data } = await supabase.rpc('get_ticket_payment_state', {
        p_public_token: publicToken,
      });
      if (!active) return;
      const row = Array.isArray(data) ? data[0] : data;
      setPayment((row as PaymentState | undefined) || null);
    };

    void load();
    const timer = window.setInterval(load, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [publicToken]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const blocked = useMemo(
    () => Boolean(payment?.payment_required && payment.payment_status !== 'paid'),
    [payment]
  );

  const remaining = useMemo(
    () => formatRemaining(payment?.payment_due_at || null, now),
    [payment?.payment_due_at, now]
  );

  useEffect(() => {
    const applyButtonState = () => {
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
      const useButton = buttons.find((button) => button.textContent?.includes('使用する'));
      if (!useButton) return;
      useButton.disabled = blocked;
      useButton.title = blocked ? '支払い完了後に使用できます。' : '';
      useButton.style.opacity = blocked ? '0.45' : '';
      useButton.style.cursor = blocked ? 'not-allowed' : '';
    };

    applyButtonState();
    const observer = new MutationObserver(applyButtonState);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [blocked]);

  return (
    <>
      {payment?.payment_required && (
        <div style={{ maxWidth: 760, margin: '20px auto 0', padding: '0 16px' }}>
          <div
            className="glass-card"
            style={{
              border: `3px solid ${payment.payment_status === 'paid' ? '#10b981' : '#f59e0b'}`,
              padding: '22px 18px',
              textAlign: 'center',
              boxShadow: payment.payment_status === 'paid'
                ? '0 0 24px rgba(16,185,129,0.18)'
                : '0 0 24px rgba(245,158,11,0.24)',
            }}
          >
            <div style={{ fontWeight: 900, fontSize: '1.35rem', marginBottom: 10 }}>
              {payment.payment_status === 'paid' ? '支払い確認済み' : 'まだ予約は確定していません'}
            </div>
            {payment.payment_status === 'paid' ? (
              <div style={{ fontSize: '1rem' }}>支払日時：{formatJst(payment.paid_at)}</div>
            ) : (
              <>
                <div style={{ fontSize: '1rem', lineHeight: 1.7, marginBottom: 10 }}>
                  下の期限までに支払わないと、この予約は自動的に取り消されます。
                </div>
                <div
                  style={{
                    fontWeight: 900,
                    fontSize: 'clamp(1.7rem, 5vw, 2.8rem)',
                    lineHeight: 1.25,
                    color: payment.payment_status === 'expired' ? 'var(--color-danger)' : '#f59e0b',
                    margin: '8px 0',
                  }}
                >
                  {remaining}
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, marginTop: 8 }}>
                  支払期限：{formatJst(payment.payment_due_at)}
                </div>
                <div style={{ marginTop: 10, fontWeight: 700 }}>
                  支払いが完了するまで、この予約券は使用できません。
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
