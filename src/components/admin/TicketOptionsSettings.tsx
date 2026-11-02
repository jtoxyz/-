'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminSupabase as supabase } from '@/lib/supabase';

type QuestionType = 'text' | 'single' | 'multiple' | 'rating';
type Question = { id: string; text: string; type: QuestionType; options: string[]; required: boolean };
type OptionRow = {
  id: string; // 新規は 'new-' で始まる仮ID
  label: string;
  description: string;
  price_yen: number;
  requires_survey: boolean;
  per_slot_limit: string; // 空欄=制限なし（枠の総定員の範囲内）
  is_enabled: boolean;
};

const TYPE_LABELS: Record<QuestionType, string> = {
  text: '自由記述',
  single: '1つ選ぶ',
  multiple: '複数選ぶ',
  rating: '5段階評価',
};

/**
 * 券種（例: アンケート回答 100円 / 通常 500円）とアンケート設問の設定。
 * 券種は枠の総定員を共有する。保存は企画本体とは別に、このパネルの保存ボタンで行う。
 */
export default function TicketOptionsSettings({ eventId }: { eventId: string }) {
  const [options, setOptions] = useState<OptionRow[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [intro, setIntro] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [eventResult, optionResult] = await Promise.all([
      supabase.from('events').select('survey_config').eq('id', eventId).single(),
      supabase.from('event_ticket_options').select('*').eq('event_id', eventId).order('sort_order'),
    ]);
    const config = eventResult.data?.survey_config as { intro?: string; questions?: Question[] } | null | undefined;
    setIntro(config?.intro ?? '');
    setQuestions((config?.questions ?? []).map((q) => ({ ...q, options: q.options ?? [], required: Boolean(q.required) })));
    setOptions(
      (optionResult.data ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        description: o.description ?? '',
        price_yen: o.price_yen,
        requires_survey: o.requires_survey,
        per_slot_limit: o.per_slot_limit === null || o.per_slot_limit === undefined ? '' : String(o.per_slot_limit),
        is_enabled: o.is_enabled,
      })),
    );
    setRemovedIds([]);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateOption = (id: string, patch: Partial<OptionRow>) =>
    setOptions((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const updateQuestion = (id: string, patch: Partial<Question>) =>
    setQuestions((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const addOption = () =>
    setOptions((rows) => [
      ...rows,
      { id: `new-${crypto.randomUUID()}`, label: '', description: '', price_yen: 0, requires_survey: false, per_slot_limit: '', is_enabled: true },
    ]);
  const removeOption = (row: OptionRow) => {
    setOptions((rows) => rows.filter((r) => r.id !== row.id));
    if (!row.id.startsWith('new-')) setRemovedIds((ids) => [...ids, row.id]);
  };
  const addQuestion = () =>
    setQuestions((rows) => {
      let n = rows.length + 1;
      while (rows.some((r) => r.id === `q${n}`)) n += 1;
      return [...rows, { id: `q${n}`, text: '', type: 'single', options: ['', ''], required: true }];
    });

  const save = async () => {
    setMessage(null);
    const cleanOptions = options.map((o) => ({ ...o, label: o.label.trim() }));
    if (cleanOptions.some((o) => !o.label)) return setMessage({ type: 'error', text: '券種の名前を入力してください。' });
    if (cleanOptions.some((o) => o.price_yen < 0 || !Number.isInteger(o.price_yen))) return setMessage({ type: 'error', text: '金額は0以上の整数で入力してください。' });
    if (cleanOptions.some((o) => o.per_slot_limit !== '' && !(Number(o.per_slot_limit) >= 0 && Number.isInteger(Number(o.per_slot_limit))))) {
      return setMessage({ type: 'error', text: '1枠あたりの上限は0以上の整数で入力してください。' });
    }

    const cleanQuestions = questions.map((q) => ({
      ...q,
      text: q.text.trim(),
      options: q.type === 'single' || q.type === 'multiple' ? q.options.map((o) => o.trim()).filter(Boolean) : [],
    }));
    if (cleanQuestions.some((q) => !q.text)) return setMessage({ type: 'error', text: '設問の文章を入力してください。' });
    if (cleanQuestions.some((q) => (q.type === 'single' || q.type === 'multiple') && new Set(q.options).size < 2)) {
      return setMessage({ type: 'error', text: '選択式の設問には、重複しない選択肢を2つ以上入力してください。' });
    }
    if (cleanOptions.some((o) => o.requires_survey && o.is_enabled) && cleanQuestions.length === 0) {
      return setMessage({ type: 'error', text: 'アンケートが必要な券種があるので、設問を1つ以上追加してください。' });
    }

    setSaving(true);
    try {
      const surveyConfig = cleanQuestions.length > 0 ? { intro: intro.trim(), questions: cleanQuestions } : null;
      const { error: eventError } = await supabase.from('events').update({ survey_config: surveyConfig }).eq('id', eventId);
      if (eventError) throw eventError;

      if (removedIds.length > 0) {
        const { error: deleteError } = await supabase.from('event_ticket_options').delete().in('id', removedIds);
        if (deleteError) {
          throw new Error('すでに予約が入っている券種は削除できません。削除せず「受付する」のチェックを外してください。');
        }
      }

      for (const [index, o] of cleanOptions.entries()) {
        const payload = {
          event_id: eventId,
          label: o.label,
          description: o.description.trim() || null,
          price_yen: o.price_yen,
          requires_survey: o.requires_survey,
          per_slot_limit: o.per_slot_limit === '' ? null : Number(o.per_slot_limit),
          is_enabled: o.is_enabled,
          sort_order: index,
        };
        const { error } = o.id.startsWith('new-')
          ? await supabase.from('event_ticket_options').insert([payload])
          : await supabase.from('event_ticket_options').update(payload).eq('id', o.id);
        if (error) throw error;
      }
      await load();
      setMessage({ type: 'ok', text: '券種とアンケートを保存しました。' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : (err as { message?: string })?.message || '保存に失敗しました。' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-spinner" />;

  return (
    <div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.7 }}>
        予約時に選ぶ「券種」を作れます。どの券種も、各開催枠の総定員（例: 1日250食）を共有します。
        たとえば「アンケート回答 100円」と「アンケートなし 500円」を作っても、合計が250食を超えることはありません。
        券種を1つ以上作ると、この企画は券種を選ばないと予約できなくなり、複数枠の一括予約は使えなくなります。
      </p>

      <h4 style={{ marginBottom: 10 }}>券種</h4>
      <div style={{ display: 'grid', gap: 12 }}>
        {options.map((o) => (
          <div key={o.id} className="glass-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <label>名前<input className="input" value={o.label} placeholder="アンケート回答" maxLength={60} onChange={(e) => updateOption(o.id, { label: e.target.value })} /></label>
              <label>金額（円）<input className="input" type="number" min={0} value={o.price_yen} onChange={(e) => updateOption(o.id, { price_yen: parseInt(e.target.value, 10) || 0 })} /></label>
              <label>1枠あたりの上限（空欄=制限なし）<input className="input" type="number" min={0} value={o.per_slot_limit} onChange={(e) => updateOption(o.id, { per_slot_limit: e.target.value })} /></label>
            </div>
            <label>説明（任意）<input className="input" value={o.description} onChange={(e) => updateOption(o.id, { description: e.target.value })} /></label>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={o.requires_survey} onChange={(e) => updateOption(o.id, { requires_survey: e.target.checked })} />アンケートへの回答が必要</label>
              <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={o.is_enabled} onChange={(e) => updateOption(o.id, { is_enabled: e.target.checked })} />受付する</label>
              <button type="button" className="btn btn-danger" onClick={() => removeOption(o)} disabled={saving}>削除</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={addOption} disabled={saving}>＋ 券種を追加</button>

      <h4 style={{ margin: '24px 0 10px' }}>アンケートの設問</h4>
      <label>アンケートの説明文（任意）<input className="input" value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="ご協力ありがとうございます。" /></label>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        {questions.map((q, index) => (
          <div key={q.id} className="glass-card" style={{ padding: 14, display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10 }}>
              <label>設問 {index + 1}<input className="input" value={q.text} onChange={(e) => updateQuestion(q.id, { text: e.target.value })} /></label>
              <label>形式
                <select className="input" value={q.type} onChange={(e) => updateQuestion(q.id, { type: e.target.value as QuestionType })}>
                  {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
            </div>
            {(q.type === 'single' || q.type === 'multiple') && (
              <label>選択肢（1行に1つ）
                <textarea className="input" rows={3} value={q.options.join('\n')} onChange={(e) => updateQuestion(q.id, { options: e.target.value.split('\n') })} />
              </label>
            )}
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(q.id, { required: e.target.checked })} />必須</label>
              <button type="button" className="btn btn-danger" onClick={() => setQuestions((rows) => rows.filter((r) => r.id !== q.id))} disabled={saving}>削除</button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-secondary" style={{ marginTop: 12 }} onClick={addQuestion} disabled={saving}>＋ 設問を追加</button>

      {message && <div className={message.type === 'ok' ? undefined : 'error-banner'} style={{ marginTop: 16, ...(message.type === 'ok' ? { color: 'var(--color-success, #1a8f4a)', fontWeight: 700 } : {}) }}>{message.text}</div>}
      <button type="button" className="btn btn-primary" style={{ marginTop: 16 }} onClick={save} disabled={saving}>{saving ? '保存中...' : '券種とアンケートを保存'}</button>
    </div>
  );
}
