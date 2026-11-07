'use client';

import { useCallback, useState } from 'react';
import { adminSupabase as supabase } from '@/lib/supabase';
import { SURVEY_TYPE_LABELS, isChoiceQuestion, type SurveyQuestion, type SurveyQuestionType, type SurveyShowIf } from '@/lib/survey';
import { useLoadEffect } from '@/hooks/useLoadEffect';

type QuestionType = SurveyQuestionType;
type Question = { id: string; text: string; type: QuestionType; options: string[]; required: boolean; show_if: SurveyShowIf | null };
type OptionRow = {
  id: string; // 新規は 'new-' で始まる仮ID
  label: string;
  description: string;
  price_yen: number;
  requires_survey: boolean;
  per_slot_limit: string; // 空欄=制限なし（枠の総定員の範囲内）
  is_enabled: boolean;
};

const TYPE_LABELS = SURVEY_TYPE_LABELS;

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
    const config = eventResult.data?.survey_config as { intro?: string; questions?: SurveyQuestion[] } | null | undefined;
    setIntro(config?.intro ?? '');
    setQuestions((config?.questions ?? []).map((q) => ({ ...q, options: q.options ?? [], required: Boolean(q.required), show_if: q.show_if ?? null })));
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

  useLoadEffect(() => load(), [load]);

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
      return [...rows, { id: `q${n}`, text: '', type: 'single', options: ['', ''], required: true, show_if: null }];
    });

  const save = async () => {
    setMessage(null);
    const cleanOptions = options.map((o) => ({ ...o, label: o.label.trim() }));
    if (cleanOptions.some((o) => !o.label)) return setMessage({ type: 'error', text: '券種の名前を入力してください。' });
    if (cleanOptions.some((o) => o.price_yen < 0 || !Number.isInteger(o.price_yen))) return setMessage({ type: 'error', text: '金額は0以上の整数で入力してください。' });
    if (cleanOptions.some((o) => o.per_slot_limit !== '' && !(Number(o.per_slot_limit) >= 0 && Number.isInteger(Number(o.per_slot_limit))))) {
      return setMessage({ type: 'error', text: '1枠あたりの上限は0以上の整数で入力してください。' });
    }

    const trimmed = questions.map((q) => ({
      ...q,
      text: q.text.trim(),
      options: isChoiceQuestion(q) ? q.options.map((o) => o.trim()).filter(Boolean) : [],
    }));
    if (trimmed.some((q) => !q.text)) return setMessage({ type: 'error', text: '設問の文章を入力してください。' });
    if (trimmed.some((q) => isChoiceQuestion(q) && new Set(q.options).size < 2)) {
      return setMessage({ type: 'error', text: '選択式の設問には、重複しない選択肢を2つ以上入力してください。' });
    }
    // 表示条件は「前にある選択式の設問」の「今ある選択肢」だけ
    for (const [index, q] of trimmed.entries()) {
      if (!q.show_if) continue;
      const parentIndex = trimmed.findIndex((row) => row.id === q.show_if!.question_id);
      const parent = trimmed[parentIndex];
      if (!parent || parentIndex >= index || !isChoiceQuestion(parent)) {
        return setMessage({ type: 'error', text: `設問${index + 1}の表示条件の設問が見つかりません。条件を選び直してください。` });
      }
      if (q.show_if.values.length === 0) {
        return setMessage({ type: 'error', text: `設問${index + 1}の表示条件で、選択肢を1つ以上選んでください。` });
      }
      if (q.show_if.values.some((v) => !parent.options.includes(v))) {
        return setMessage({ type: 'error', text: `設問${index + 1}の表示条件に、設問${parentIndex + 1}にない選択肢があります。条件を選び直してください。` });
      }
    }
    if (trimmed.length > 0 && trimmed[0].show_if) {
      return setMessage({ type: 'error', text: '設問1には表示条件を付けられません。' });
    }
    const cleanQuestions = trimmed.map(({ show_if, ...q }) => (show_if ? { ...q, show_if } : q));
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
            {index > 0 && <ShowIfEditor question={q} earlier={questions.slice(0, index)} onChange={(show_if) => updateQuestion(q.id, { show_if })} />}
            <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={q.required} onChange={(e) => updateQuestion(q.id, { required: e.target.checked })} />必須</label>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const dependents = questions.filter((r) => r.show_if?.question_id === q.id).length;
                  if (dependents > 0 && !confirm(`この設問を表示条件にしている設問が${dependents}個あります。削除すると、それらの表示条件も外れます。削除しますか？`)) return;
                  setQuestions((rows) => rows.filter((r) => r.id !== q.id).map((r) => (r.show_if?.question_id === q.id ? { ...r, show_if: null } : r)));
                }}
                disabled={saving}
              >削除</button>
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

/** 「前の設問で◯◯を選んだ人だけに表示」の設定 */
function ShowIfEditor({ question, earlier, onChange }: { question: Question; earlier: Question[]; onChange: (showIf: SurveyShowIf | null) => void }) {
  const candidates = earlier.map((q, i) => ({ q, number: i + 1 })).filter(({ q }) => isChoiceQuestion(q));
  const cond = question.show_if;
  const parent = cond ? candidates.find(({ q }) => q.id === cond.question_id)?.q : undefined;
  const parentOptions = parent ? parent.options.map((o) => o.trim()).filter(Boolean) : [];
  const staleValues = cond ? cond.values.filter((v) => !parentOptions.includes(v)) : [];

  return (
    <div style={{ display: 'grid', gap: 8, padding: 10, borderRadius: 8, border: '1px dashed var(--card-border)' }}>
      <label>表示条件
        <select
          className="input"
          value={cond?.question_id ?? ''}
          onChange={(e) => onChange(e.target.value ? { question_id: e.target.value, values: [] } : null)}
        >
          <option value="">いつも表示する</option>
          {candidates.map(({ q, number }) => (
            <option key={q.id} value={q.id}>設問{number}「{q.text || '（未入力）'}」の答えによって表示する</option>
          ))}
          {cond && !parent && <option value={cond.question_id}>（条件の設問が見つからないか、選択式ではありません）</option>}
        </select>
      </label>
      {candidates.length === 0 && !cond && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>前に「1つ選ぶ」か「複数選ぶ」の設問があると、その答えによって出し分けられます。</div>
      )}
      {cond && parent && (
        <div>
          <div style={{ fontSize: '0.85rem', marginBottom: 4 }}>次のどれかを選んだ人だけに表示する</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            {parentOptions.map((opt) => (
              <label key={opt} style={{ display: 'flex', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={cond.values.includes(opt)}
                  onChange={() => onChange({ ...cond, values: cond.values.includes(opt) ? cond.values.filter((v) => v !== opt) : [...cond.values, opt] })}
                />
                {opt}
              </label>
            ))}
          </div>
          {staleValues.length > 0 && (
            <div className="error-banner" style={{ marginTop: 6 }}>
              選択肢にない「{staleValues.join('」「')}」が条件に残っています。
              <button type="button" className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }} onClick={() => onChange({ ...cond, values: cond.values.filter((v) => parentOptions.includes(v)) })}>外す</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
