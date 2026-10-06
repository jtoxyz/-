'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { type PaymentVisitSlot, formatVisitSlot, jstDateKey } from '@/lib/paymentVisit';

type Props = {
  paymentRequired: boolean;
  onPaymentRequiredChange: (value: boolean) => void;
  visitRequired: boolean;
  onVisitRequiredChange: (value: boolean) => void;
  disabled?: boolean;
};

function jstIso(dateKey: string, time: string): string {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

/** 企画作成・編集フォーム用：支払い必須／委員会室の来室日時選択と、受付枠（全企画共通）の追加 */
export default function PaymentVisitSettings({
  paymentRequired,
  onPaymentRequiredChange,
  visitRequired,
  onVisitRequiredChange,
  disabled = false,
}: Props) {
  const [slots, setSlots] = useState<PaymentVisitSlot[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newDate, setNewDate] = useState(() => jstDateKey(new Date()));
  const [newStart, setNewStart] = useState('12:30');
  const [newEnd, setNewEnd] = useState('13:00');
  const [newNote, setNewNote] = useState('');
  const [adding, setAdding] = useState(false);

  const loadSlots = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('payment_visit_slots')
      .select('id,starts_at,ends_at,note,is_active')
      .eq('is_active', true)
      .gt('ends_at', new Date().toISOString())
      .order('starts_at', { ascending: true });
    if (fetchError) setError(fetchError.message);
    else setSlots((data as PaymentVisitSlot[]) || []);
  }, []);

  useEffect(() => {
    if (visitRequired) void loadSlots();
  }, [visitRequired, loadSlots]);

  const addSlot = async () => {
    const startsAt = jstIso(newDate, newStart);
    const endsAt = jstIso(newDate, newEnd);
    if (!newDate || !newStart || !newEnd || new Date(endsAt) <= new Date(startsAt)) {
      setError('終了時刻は開始時刻より後にしてください。');
      return;
    }
    setAdding(true);
    setError(null);
    const { error: insertError } = await supabase
      .from('payment_visit_slots')
      .insert({ starts_at: startsAt, ends_at: endsAt, note: newNote.trim() || null });
    if (insertError) setError(insertError.message);
    else {
      setNewNote('');
      await loadSlots();
    }
    setAdding(false);
  };

  return (
    <div>
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
          <input type="checkbox" checked={paymentRequired} onChange={(e) => onPaymentRequiredChange(e.target.checked)} disabled={disabled} />
          この企画は支払いが必要
        </label>
        <span className="form-hint">支払期限（当日券など向け）や支払いQRは「支払い設定」「支払いQR」の画面で設定します。</span>
      </div>

      {paymentRequired && (
        <div className="form-group">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <input type="checkbox" checked={visitRequired} onChange={(e) => onVisitRequiredChange(e.target.checked)} disabled={disabled} />
            予約時に、委員会室へ支払いに来る日時を選ばせる
          </label>
          <span className="form-hint">
            ONにすると、学生は予約するときに下の受付枠から来室日時を1つ選びます。選んだ枠の終了時刻までに支払いがない予約は自動でキャンセルされます。
          </span>
        </div>
      )}

      {paymentRequired && visitRequired && (
        <div style={{ border: '1px solid var(--card-border)', borderRadius: 12, padding: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>委員会室の受付枠（全企画共通）</div>
          <p className="form-hint" style={{ marginTop: 0 }}>
            学生が選べる日時です。ほかの企画とも共通です。停止・削除や当日の来室予定は
            <Link href="/admin/payment-visits" style={{ margin: '0 4px', textDecoration: 'underline' }}>委員会室 支払い受付</Link>
            で行います。
          </p>

          {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}

          {slots.length === 0 ? (
            <div className="error-banner" style={{ marginBottom: 12 }}>
              選べる受付枠がありません。下で追加しないと、学生はこの企画を予約できません。
            </div>
          ) : (
            <ul style={{ margin: '0 0 14px', paddingLeft: 20, lineHeight: 1.8 }}>
              {slots.map((slot) => (
                <li key={slot.id}>
                  {formatVisitSlot(slot)}
                  {slot.note && <span style={{ color: 'var(--text-secondary)' }}>（{slot.note}）</span>}
                </li>
              ))}
            </ul>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="pv-date">日付</label>
              <input id="pv-date" type="date" className="form-input" value={newDate} onChange={(e) => setNewDate(e.target.value)} disabled={disabled || adding} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="pv-start">開始</label>
              <input id="pv-start" type="time" className="form-input" value={newStart} onChange={(e) => setNewStart(e.target.value)} disabled={disabled || adding} />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="pv-end">終了</label>
              <input id="pv-end" type="time" className="form-input" value={newEnd} onChange={(e) => setNewEnd(e.target.value)} disabled={disabled || adding} />
            </div>
            <div className="form-group" style={{ margin: 0, flex: '1 1 160px' }}>
              <label className="form-label" htmlFor="pv-note">メモ（任意）</label>
              <input id="pv-note" type="text" className="form-input" placeholder="例：昼休み" value={newNote} onChange={(e) => setNewNote(e.target.value)} disabled={disabled || adding} />
            </div>
            <button type="button" className="btn btn-secondary" onClick={addSlot} disabled={disabled || adding}>
              {adding ? '追加中...' : '受付枠を追加'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
