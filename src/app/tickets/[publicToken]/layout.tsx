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

export default function TicketPaymentLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ publicToken: string }>;
}>) {
  const { publicToken } = use(params);
  const [payment, setPayment] = useState<PaymentState | null>(null);

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

  const blocked = useMemo(
    () => Boolean(payment?.payment_required && payment.payment_status !== 'paid'),
    [payment]
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
              borderLeft: `5px solid ${payment.payment_status === 'paid' ? '#10b981' : '#f59e0b'}`,
              padding: 18,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: 8 }}>
              {payment.payment_status === 'paid' ? '支払い確認済み' : '支払い待ち（仮予約）'}
            </div>
            {payment.payment_status === 'paid' ? (
              <div>支払日時：{formatJst(payment.paid_at)}</div>
            ) : (
              <>
                <div style={{ lineHeight: 1.7 }}>
                  支払いが完了するまで、この予約券は使用できません。
                </div>
                <div style={{ marginTop: 6, fontWeight: 700 }}>
                  支払期限：{formatJst(payment.payment_due_at)}
                </div>
                {payment.payment_status === 'expired' && (
                  <div style={{ marginTop: 8, color: 'var(--color-danger)', fontWeight: 800 }}>
                    支払期限を過ぎています。
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
