'use client';

export const runtime = 'edge';

import { useEffect, useState } from 'react';
import AdminNav from '@/components/AdminNav';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import { supabase } from '@/lib/supabase';

export default function StudentNumberSettingsPage() {
  const { loading: authLoading, user } = useAdminAuth();
  const [codes, setCodes] = useState<string[]>([]);
  const [newCode, setNewCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      void loadCodes();
    }
  }, [authLoading, user]);

  const loadCodes = async () => {
    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('get_allowed_student_department_codes');

    if (rpcError) {
      setError(rpcError.message || '学科コードの取得に失敗しました。');
    } else {
      setCodes(Array.isArray(data) ? data : []);
    }

    setLoading(false);
  };

  const addCode = () => {
    const normalized = newCode.trim().toUpperCase();

    if (!/^[A-Z]$/.test(normalized)) {
      setError('学科コードは半角英字1文字で入力してください。');
      return;
    }

    if (codes.includes(normalized)) {
      setError(`${normalized} はすでに登録されています。`);
      return;
    }

    setCodes((current) => [...current, normalized].sort());
    setNewCode('');
    setError(null);
  };

  const removeCode = (code: string) => {
    if (codes.length <= 1) {
      setError('学科コードは最低1つ必要です。');
      return;
    }

    setCodes((current) => current.filter((item) => item !== code));
    setError(null);
  };

  const saveCodes = async () => {
    setSaving(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('update_allowed_student_department_codes', {
      p_codes: codes,
    });

    if (rpcError) {
      setError(rpcError.message || '学科コードの保存に失敗しました。');
      setSaving(false);
      return;
    }

    setCodes(Array.isArray(data) ? data : codes);
    alert('学科コード設定を保存しました。今後の予約にすぐ反映されます。');
    setSaving(false);
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
          <div className="glass-card" style={{ maxWidth: '760px' }}>
            <h1 style={{ marginTop: 0, color: 'var(--text-primary)' }}>学籍番号設定</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              予約時に使用できる学科コードを全企画共通で管理します。新しい学科コードが追加された場合は、ここで登録すると即時反映されます。
            </p>

            {error && <div className="error-banner" style={{ marginBottom: '16px' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
              <input
                className="form-input"
                value={newCode}
                maxLength={1}
                placeholder="例：A"
                onChange={(event) => setNewCode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCode();
                  }
                }}
                style={{ width: '120px', textTransform: 'uppercase' }}
              />
              <button type="button" className="btn btn-secondary" onClick={addCode}>
                ＋ コードを追加
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '24px' }}>
              {codes.map((code) => (
                <div
                  key={code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    border: '1px solid var(--card-border)',
                    borderRadius: '999px',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    fontWeight: 700,
                  }}
                >
                  <span>{code}</span>
                  <button
                    type="button"
                    onClick={() => removeCode(code)}
                    aria-label={`${code}を削除`}
                    style={{ border: 0, background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer', fontSize: '1rem' }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            <div style={{ padding: '14px', borderRadius: 'var(--radius-sm)', background: 'var(--color-warning-bg)', color: 'var(--text-secondary)', marginBottom: '20px' }}>
              コードを削除すると、その文字を含む学籍番号では新しい予約ができなくなります。既存の予約データは削除されません。
            </div>

            <button type="button" className="btn btn-primary" onClick={saveCodes} disabled={saving || codes.length === 0}>
              {saving ? '保存中...' : '設定を保存'}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}
