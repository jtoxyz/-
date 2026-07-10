'use client';

export const runtime = 'edge';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

interface AdminPreRegistration {
  id: string;
  student_name: string;
  student_number: string;
  university_email: string;
  ticket_type: 'reservation' | 'walkin';
  status: 'reserved' | 'active' | 'activation_failed' | 'cancelled';
  activation_error: string | null;
  created_at: string;
  event_slots: { label: string } | null;
  event_slot_id: string;
}

interface EventSlot {
  id: string;
  label: string;
  is_reservation_enabled: boolean;
  is_walkin_enabled: boolean;
}

export default function AdminPreRegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useAdminAuth();

  const [eventTitle, setEventTitle] = useState('');
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [preRegistrations, setPreRegistrations] = useState<AdminPreRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [adding, setAdding] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [universityEmail, setUniversityEmail] = useState('');
  const [ticketType, setTicketType] = useState<'reservation' | 'walkin'>('reservation');

  const loadData = async () => {
    try {
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('title')
        .eq('id', id)
        .single();

      if (eventError || !eventData) {
        setError('企画情報が見つかりません。');
        setLoading(false);
        return;
      }
      setEventTitle(eventData.title);

      const { data: slotsData, error: slotsError } = await supabase
        .from('event_slots')
        .select('id, label, is_reservation_enabled, is_walkin_enabled')
        .eq('event_id', id)
        .eq('is_enabled', true)
        .order('sort_order');

      if (!slotsError && slotsData) {
        setSlots(slotsData as EventSlot[]);
        if (slotsData.length > 0) {
          setSelectedSlotId(slotsData[0].id);
        }
      }

      const { data: preRegData, error: preRegError } = await supabase
        .from('admin_pre_registrations')
        .select('*, event_slots(label)')
        .eq('event_id', id)
        .order('created_at', { ascending: false });

      if (preRegError) {
        setError('事前登録データの取得に失敗しました。');
      } else {
        setPreRegistrations(preRegData as unknown as AdminPreRegistration[]);
      }

    } catch (err) {
      console.error(err);
      setError('データ読み込み中にエラーが発生しました。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadData();
    }
  }, [id, authLoading, user]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAdding(true);

    try {
      if (!selectedSlotId || !studentName.trim() || !studentNumber.trim() || !universityEmail.trim()) {
        setError('すべての項目を入力してください。');
        setAdding(false);
        return;
      }

      const normalizedNumber = studentNumber.replace(/\s+/g, '').toUpperCase().replace(/^S/, '');

      const { error: insertError } = await supabase
        .from('admin_pre_registrations')
        .insert([{
          event_id: id,
          event_slot_id: selectedSlotId,
          student_name: studentName.trim(),
          student_number: normalizedNumber,
          university_email: universityEmail.trim().toLowerCase(),
          ticket_type: ticketType
        }]);

      if (insertError) {
        setError(`事前登録に失敗しました: ${insertError.message}`);
        setAdding(false);
        return;
      }

      // 登録成功したらフォームをクリアして再読み込み
      setStudentName('');
      setStudentNumber('');
      setUniversityEmail('');
      await loadData();
    } catch (err) {
      console.error(err);
      setError('サーバー処理中にエラーが発生しました。');
    } finally {
      setAdding(false);
    }
  };

  const handleCancel = async (preRegId: string) => {
    if (!confirm('この事前登録をキャンセルしますか？')) return;

    try {
      const { error: cancelError } = await supabase
        .from('admin_pre_registrations')
        .update({ status: 'cancelled' })
        .eq('id', preRegId);

      if (cancelError) {
        alert(`キャンセルに失敗しました: ${cancelError.message}`);
        return;
      }
      await loadData();
    } catch (err) {
      console.error(err);
      alert('エラーが発生しました。');
    }
  };

  if (authLoading || loading) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <div className="loading-spinner"></div>
      </div>
    );
  }

  return (
    <div className="admin-mode">
      <div className="admin-layout-sidebar">
      <AdminNav />

      <div>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/admin/events" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
            ← 企画一覧に戻る
          </Link>
        </div>

        <div className="glass-card" style={{ borderLeft: '4px solid var(--color-primary)', marginBottom: '24px' }}>
          <h1 style={{ fontSize: '1.4rem', color: 'var(--text-primary)' }}>{eventTitle} - 事前参加者登録</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
            一般受付開始前に、管理者権限で参加枠を確保します。受付期間が開始されると自動的にチケットが発券されます。
          </p>

          <form onSubmit={handleAdd} style={{ marginTop: '24px', background: 'var(--card-bg)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
            <h3 style={{ fontSize: '1rem', marginBottom: '16px', color: 'var(--text-primary)' }}>新規事前登録</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label">開催枠</label>
                <select className="form-input" value={selectedSlotId} onChange={(e) => setSelectedSlotId(e.target.value)} required disabled={adding}>
                  <option value="" disabled>選択してください</option>
                  {slots.map(s => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">券種</label>
                <select className="form-input" value={ticketType} onChange={(e) => setTicketType(e.target.value as 'reservation' | 'walkin')} required disabled={adding}>
                  <option value="reservation">予約券</option>
                  <option value="walkin">当日券</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">氏名</label>
                <input type="text" className="form-input" value={studentName} onChange={(e) => setStudentName(e.target.value)} required disabled={adding} placeholder="山田 太郎" />
              </div>
              <div className="form-group">
                <label className="form-label">学籍番号</label>
                <input type="text" className="form-input" value={studentNumber} onChange={(e) => setStudentNumber(e.target.value)} required disabled={adding} placeholder="24B123" />
              </div>
              <div className="form-group">
                <label className="form-label">大学メールアドレス</label>
                <input type="email" className="form-input" value={universityEmail} onChange={(e) => setUniversityEmail(e.target.value)} required disabled={adding} placeholder="s24b123@ge.osaka-sandai.ac.jp" />
              </div>
            </div>
            
            <div style={{ marginTop: '16px' }}>
              <button type="submit" className="btn btn-primary" disabled={adding}>
                {adding ? '登録中...' : '登録する'}
              </button>
            </div>
          </form>
        </div>

        {error && (
          <div className="error-banner">
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}

        <div className="glass-card">
          <h2 style={{ fontSize: '1.1rem', color: 'var(--text-primary)', marginBottom: '12px' }}>事前登録リスト</h2>
          
          {preRegistrations.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-secondary)' }}>
              事前登録された参加者はいません。
            </div>
          ) : (
            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>登録日時</th>
                    <th>枠名</th>
                    <th>券種</th>
                    <th>氏名</th>
                    <th>学籍番号</th>
                    <th>状態</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {preRegistrations.map((pr) => (
                    <tr key={pr.id} style={{ opacity: pr.status === 'cancelled' ? 0.5 : 1 }}>
                      <td>{new Date(pr.created_at).toLocaleString('ja-JP')}</td>
                      <td>{pr.event_slots?.label || '-'}</td>
                      <td>{pr.ticket_type === 'walkin' ? '当日券' : '予約券'}</td>
                      <td style={{ fontWeight: 700 }}>{pr.student_name}</td>
                      <td>{pr.student_number}</td>
                      <td>
                        {pr.status === 'reserved' && <span className="badge badge-warning">未発券 (待機中)</span>}
                        {pr.status === 'active' && <span className="badge badge-success">発券済み</span>}
                        {pr.status === 'activation_failed' && <span className="badge badge-danger">発券失敗</span>}
                        {pr.status === 'cancelled' && <span className="badge badge-secondary">キャンセル</span>}
                        {pr.activation_error && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '4px' }}>
                            {pr.activation_error}
                          </div>
                        )}
                      </td>
                      <td>
                        {pr.status !== 'cancelled' && pr.status !== 'active' && (
                          <button
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            onClick={() => handleCancel(pr.id)}
                          >
                            ❌ 取消
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
      </div>
    </div>
  );
}
