'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAdminAuth } from '@/hooks/useAdminAuth';
import AdminNav from '@/components/AdminNav';
import { supabase } from '@/lib/supabase';

function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return true; // Empty is valid since it is optional
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Convert ISO timestamptz from DB to localized string for datetime-local input
function formatIsoToLocalString(isoStr: string | null): string {
  if (!isoStr) return '';
  const date = new Date(isoStr);
  const pad = (num: number) => num.toString().padStart(2, '0');
  
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  
  return `${YYYY}-${MM}-${DD}T${hh}:${mm}`;
}

export default function AdminEditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { loading: authLoading, user } = useAdminAuth();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [capacity, setCapacity] = useState(50);
  
  // Date/Time strings (empty string represents null)
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [reservationStartsAt, setReservationStartsAt] = useState('');
  const [reservationEndsAt, setReservationEndsAt] = useState('');
  const [useStartsAt, setUseStartsAt] = useState('');
  const [useEndsAt, setUseEndsAt] = useState('');

  // Toggles
  const [isPublic, setIsPublic] = useState(false);
  const [reservationEnabled, setReservationEnabled] = useState(true);
  const [ticketEnabled, setTicketEnabled] = useState(false);
  const [useButtonEnabled, setUseButtonEnabled] = useState(false);

  // Allowed domains
  const [allowedDomains, setAllowedDomains] = useState('');

  // Survey settings
  const [surveyAfterReservationEnabled, setSurveyAfterReservationEnabled] = useState(false);
  const [surveyAfterReservationUrl, setSurveyAfterReservationUrl] = useState('');
  const [surveyAfterReservationMessage, setSurveyAfterReservationMessage] = useState('');

  const [surveyAfterUseEnabled, setSurveyAfterUseEnabled] = useState(false);
  const [surveyAfterUseUrl, setSurveyAfterUseUrl] = useState('');
  const [surveyAfterUseMessage, setSurveyAfterUseMessage] = useState('');

  useEffect(() => {
    async function loadEvent() {
      try {
        const { data, error: loadError } = await supabase
          .from('events')
          .select('*')
          .eq('id', id)
          .single();

        if (loadError || !data) {
          setError('企画が見つからないか、エラーが発生しました。');
          setLoading(false);
          return;
        }

        // Prepopulate states
        setTitle(data.title || '');
        setDescription(data.description || '');
        setCapacity(data.capacity || 50);
        setStartsAt(formatIsoToLocalString(data.starts_at));
        setEndsAt(formatIsoToLocalString(data.ends_at));
        setReservationStartsAt(formatIsoToLocalString(data.reservation_starts_at));
        setReservationEndsAt(formatIsoToLocalString(data.reservation_ends_at));
        setUseStartsAt(formatIsoToLocalString(data.use_starts_at));
        setUseEndsAt(formatIsoToLocalString(data.use_ends_at));
        setIsPublic(data.is_public ?? false);
        setReservationEnabled(data.reservation_enabled ?? true);
        setTicketEnabled(data.ticket_enabled ?? false);
        setUseButtonEnabled(data.use_button_enabled ?? false);
        setAllowedDomains(Array.isArray(data.allowed_email_domains) ? data.allowed_email_domains.join(', ') : 'ge.osaka-sandai.ac.jp');
        
        setSurveyAfterReservationEnabled(data.survey_after_reservation_enabled ?? false);
        setSurveyAfterReservationUrl(data.survey_after_reservation_url || '');
        setSurveyAfterReservationMessage(data.survey_after_reservation_message || '今後の企画改善のため、アンケートにご協力ください。');

        setSurveyAfterUseEnabled(data.survey_after_use_enabled ?? false);
        setSurveyAfterUseUrl(data.survey_after_use_url || '');
        setSurveyAfterUseMessage(data.survey_after_use_message || 'ご参加ありがとうございました。今後の企画改善のため、アンケートにご協力ください。');
      } catch (err) {
        console.error('Failed to load event details:', err);
        setError('データの取得に失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    if (!authLoading && user) {
      loadEvent();
    }
  }, [id, authLoading, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    // Basic validation
    if (!title.trim() || capacity <= 0) {
      setError('企画名を入力し、定員には1以上の数字を入力してください。');
      setSaving(false);
      return;
    }

    // Survey URL validation
    if (surveyAfterReservationEnabled && surveyAfterReservationUrl) {
      if (!isValidUrl(surveyAfterReservationUrl)) {
        setError('予約完了後アンケートのURLは http:// または https:// の形式で入力してください。');
        setSaving(false);
        return;
      }
    }
    if (surveyAfterUseEnabled && surveyAfterUseUrl) {
      if (!isValidUrl(surveyAfterUseUrl)) {
        setError('使用後アンケートのURLは http:// または https:// の形式で入力してください。');
        setSaving(false);
        return;
      }
    }

    // Domain normalization
    const domainsArray = allowedDomains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d !== '');

    if (domainsArray.length === 0) {
      setError('許可するメールドメインを少なくとも1つ入力してください。');
      setSaving(false);
      return;
    }

    // Prepare data
    const eventData = {
      title: title.trim(),
      description: description.trim() || null,
      capacity,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
      reservation_starts_at: reservationStartsAt ? new Date(reservationStartsAt).toISOString() : null,
      reservation_ends_at: reservationEndsAt ? new Date(reservationEndsAt).toISOString() : null,
      use_starts_at: useStartsAt ? new Date(useStartsAt).toISOString() : null,
      use_ends_at: useEndsAt ? new Date(useEndsAt).toISOString() : null,
      is_public: isPublic,
      reservation_enabled: reservationEnabled,
      ticket_enabled: ticketEnabled,
      use_button_enabled: useButtonEnabled,
      allowed_email_domains: domainsArray,
      survey_after_reservation_enabled: surveyAfterReservationEnabled,
      survey_after_reservation_url: surveyAfterReservationUrl.trim() || null,
      survey_after_reservation_message: surveyAfterReservationMessage.trim() || null,
      survey_after_use_enabled: surveyAfterUseEnabled,
      survey_after_use_url: surveyAfterUseUrl.trim() || null,
      survey_after_use_message: surveyAfterUseMessage.trim() || null,
      updated_at: new Date().toISOString()
    };

    try {
      const { error: updateError } = await supabase
        .from('events')
        .update(eventData)
        .eq('id', id);

      if (updateError) {
        setError(updateError.message || '企画の更新に失敗しました。');
        setSaving(false);
        return;
      }

      // Success: Redirect to dashboard
      router.push('/admin/events');
    } catch (err) {
      console.error('Error updating event:', err);
      setError('サーバー処理中にエラーが発生しました。');
      setSaving(false);
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
      <AdminNav />

      <div style={{ marginBottom: '20px' }}>
        <Link href="/admin/events" style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          ← 企画一覧に戻る
        </Link>
      </div>

      <div className="glass-card">
        <h1 style={{ fontSize: '1.5rem', marginBottom: '24px', color: '#ffffff' }}>
          企画設定の編集
        </h1>

        {error && (
          <div className="error-banner">
            <span>⚠️</span>
            <div>{error}</div>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Section: Basic details */}
          <div style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: '16px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              1. 企画基本情報
            </h3>
            
            <div className="form-group">
              <label className="form-label" htmlFor="title">企画名</label>
              <input
                id="title"
                type="text"
                className="form-input"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="description">説明文</label>
              <textarea
                id="description"
                className="form-input"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="capacity">定員 (予約上限数)</label>
              <input
                id="capacity"
                type="number"
                className="form-input"
                min={1}
                required
                value={capacity}
                onChange={(e) => setCapacity(parseInt(e.target.value) || 0)}
                disabled={saving}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="allowedDomains">許可する大学メールのドメイン (カンマ区切り)</label>
              <input
                id="allowedDomains"
                type="text"
                className="form-input"
                placeholder="ge.osaka-sandai.ac.jp,osaka-sandai.ac.jp"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                disabled={saving}
              />
              <span className="form-hint">複数のドメインを許可する場合は、カンマ(,)で区切って入力してください。</span>
            </div>
          </div>

          {/* Section: Timings */}
          <div style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: '16px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              2. 日程・受付時間設定
            </h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="startsAt">開催日時（開始）</label>
                <input
                  id="startsAt"
                  type="datetime-local"
                  className="form-input"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="endsAt">開催日時（終了）</label>
                <input
                  id="endsAt"
                  type="datetime-local"
                  className="form-input"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div className="form-group">
                <label className="form-label" htmlFor="reservationStartsAt">予約受付開始日時</label>
                <input
                  id="reservationStartsAt"
                  type="datetime-local"
                  className="form-input"
                  value={reservationStartsAt}
                  onChange={(e) => setReservationStartsAt(e.target.value)}
                  disabled={saving}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="reservationEndsAt">予約受付終了日時</label>
                <input
                  id="reservationEndsAt"
                  type="datetime-local"
                  className="form-input"
                  value={reservationEndsAt}
                  onChange={(e) => setReservationEndsAt(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* Section: Ticket features */}
          <div style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: '16px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              3. 電子チケット・使用ボタン設定
            </h3>
            
            <div className="form-group">
              <label className="form-checkbox-label">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={ticketEnabled}
                  onChange={(e) => {
                    setTicketEnabled(e.target.checked);
                    if (!e.target.checked) setUseButtonEnabled(false);
                  }}
                  disabled={saving}
                />
                電子チケット機能（引き換えコード）を有効にする
              </label>
            </div>

            {ticketEnabled && (
              <>
                <div className="form-group" style={{ marginLeft: '24px' }}>
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={useButtonEnabled}
                      onChange={(e) => setUseButtonEnabled(e.target.checked)}
                      disabled={saving}
                    />
                    「使用する」ボタンを有効にする (店員前でのタップ認証)
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginLeft: '24px' }}>
                  <div className="form-group">
                    <label className="form-label" htmlFor="useStartsAt">使用可能開始時刻</label>
                    <input
                      id="useStartsAt"
                      type="datetime-local"
                      className="form-input"
                      value={useStartsAt}
                      onChange={(e) => setUseStartsAt(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="useEndsAt">使用可能終了時刻</label>
                    <input
                      id="useEndsAt"
                      type="datetime-local"
                      className="form-input"
                      value={useEndsAt}
                      onChange={(e) => setUseEndsAt(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Section: Surveys */}
          <div style={{ borderBottom: '1px solid var(--card-border)', paddingBottom: '16px', marginBottom: '24px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              4. 外部アンケート連携 (Googleフォーム等)
            </h3>

            {/* Reservation survey */}
            <div style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={surveyAfterReservationEnabled}
                    onChange={(e) => setSurveyAfterReservationEnabled(e.target.checked)}
                    disabled={saving}
                  />
                  予約完了後にアンケートを表示する
                </label>
              </div>

              {surveyAfterReservationEnabled && (
                <>
                  <div className="form-group">
                    <label className="form-label" htmlFor="surveyAfterReservationUrl">アンケートURL</label>
                    <input
                      id="surveyAfterReservationUrl"
                      type="text"
                      className="form-input"
                      placeholder="https://docs.google.com/forms/.../viewform"
                      value={surveyAfterReservationUrl}
                      onChange={(e) => setSurveyAfterReservationUrl(e.target.value)}
                      disabled={saving}
                      required={surveyAfterReservationEnabled}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="surveyAfterReservationMessage">表示用メッセージ</label>
                    <input
                      id="surveyAfterReservationMessage"
                      type="text"
                      className="form-input"
                      value={surveyAfterReservationMessage}
                      onChange={(e) => setSurveyAfterReservationMessage(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                </>
              )}
            </div>

            {/* Ticket use survey */}
            {ticketEnabled && useButtonEnabled && (
              <div style={{ background: 'rgba(255,255,255,0.01)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--card-border)' }}>
                <div className="form-group">
                  <label className="form-checkbox-label">
                    <input
                      type="checkbox"
                      className="form-checkbox"
                      checked={surveyAfterUseEnabled}
                      onChange={(e) => setSurveyAfterUseEnabled(e.target.checked)}
                      disabled={saving}
                    />
                    チケット使用（引き換え）後にアンケートを表示する
                  </label>
                </div>

                {surveyAfterUseEnabled && (
                  <>
                    <div className="form-group">
                      <label className="form-label" htmlFor="surveyAfterUseUrl">アンケートURL</label>
                      <input
                        id="surveyAfterUseUrl"
                        type="text"
                        className="form-input"
                        placeholder="https://docs.google.com/forms/.../viewform"
                        value={surveyAfterUseUrl}
                        onChange={(e) => setSurveyAfterUseUrl(e.target.value)}
                        disabled={saving}
                        required={surveyAfterUseEnabled}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label" htmlFor="surveyAfterUseMessage">表示用メッセージ</label>
                      <input
                        id="surveyAfterUseMessage"
                        type="text"
                        className="form-input"
                        value={surveyAfterUseMessage}
                        onChange={(e) => setSurveyAfterUseMessage(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section: Status */}
          <div style={{ marginBottom: '32px' }}>
            <h3 style={{ fontSize: '1.1rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
              5. 公開設定
            </h3>
            
            <div style={{ display: 'flex', gap: '24px' }}>
              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={isPublic}
                    onChange={(e) => setIsPublic(e.target.checked)}
                    disabled={saving}
                  />
                  企画を一般公開する (一覧に表示されます)
                </label>
              </div>

              <div className="form-group">
                <label className="form-checkbox-label">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={reservationEnabled}
                    onChange={(e) => setReservationEnabled(e.target.checked)}
                    disabled={saving}
                  />
                  予約の受付を有効にする
                </label>
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <Link href="/admin/events" style={{ flex: 1 }}>
              <button type="button" className="btn btn-secondary" disabled={saving}>
                キャンセル
              </button>
            </Link>
            <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
              {saving ? '保存中...' : '企画設定を保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
