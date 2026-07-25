'use client';

import { useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';

type PaymentEvent = {
  id: string;
  title: string;
  payment_required: boolean | null;
  payment_deadline_minutes: number | null;
  is_public: boolean | null;
};

export default function PaymentSettingsPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from('events')
      .select('id,title,payment_required,payment_deadline_minutes,is_public')
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message || '企画一覧の取得に失敗しました。');
    } else {
      setEvents((data as PaymentEvent[]) || []);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (!authLoading && user) {
      void loadEvents();
    }
  }, [authLoading, user]);

  const updateLocalEvent = (id: string, patch: Partial<PaymentEvent>) => {
    setEvents((current) => current.map((event) => event.id === id ? { ...event, ...patch } : event));
  };

  const saveEvent = async (event: PaymentEvent) => {
    const minutes = Number(event.payment_deadline_minutes ?? 30);

    if (event.payment_required && (!Number.isInteger(minutes) || minutes < 1)) {
      setError('支払期限は1分以上の整数で入力してください。');
      return;
    }

    setSavingId(event.id);
    setError(null);

    const { error: updateError } = await supabase
      .from('events')
      .update({
        payment_required: Boolean(event.payment_required),
        payment_deadline_minutes: event.payment_required ? minutes : 30,
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id);

    if (updateError) {
      setError(updateError.message || '支払い設定の保存に失敗しました。');
    } else {
      alert(`「${event.title}」の支払い設定を保存しました。`);
      await loadEvents();
    }

    setSavingId(null);
  };

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
        <AdminNav />
        <main>
          <div className="glass-card">
            <h1 style={{ marginTop: 0 }}>支払い設定</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              企画ごとに支払い必須と支払期限を設定します。既存企画は初期状態では支払い不要です。
            </p>

            {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

            {events.length === 0 ? (
              <p>企画がありません。</p>
            ) : (
              <div style={{ display: 'grid', gap: 16 }}>
                {events.map((event) => (
                  <div key={event.id} className="glass-card" style={{ borderLeft: event.payment_required ? '4px solid var(--color-warning)' : '4px solid var(--card-border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: '1.05rem' }}>{event.title}</strong>
                        <div style={{ marginTop: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
                          {event.is_public ? '公開中' : '非公開'}
                        </div>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(event.payment_required)}
                          onChange={(e) => updateLocalEvent(event.id, { payment_required: e.target.checked })}
                          disabled={savingId === event.id}
                        />
                        支払い必須
                      </label>
                    </div>

                    {event.payment_required && (
                      <div className="form-group" style={{ marginTop: 16, maxWidth: 320 }}>
                        <label className="form-label" htmlFor={`deadline-${event.id}`}>予約から何分以内に支払うか</label>
                        <input
                          id={`deadline-${event.id}`}
                          type="number"
                          min="1"
                          step="1"
                          className="form-input"
                          value={event.payment_deadline_minutes ?? 30}
                          onChange={(e) => updateLocalEvent(event.id, { payment_deadline_minutes: Number(e.target.value) })}
                          disabled={savingId === event.id}
                        />
                        <span className="form-hint">期限切れの未払い予約は自動キャンセルされ、枠が戻ります。</span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ marginTop: 16 }}
                      onClick={() => saveEvent(event)}
                      disabled={savingId === event.id}
                    >
                      {savingId === event.id ? '保存中...' : 'この企画の設定を保存'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
