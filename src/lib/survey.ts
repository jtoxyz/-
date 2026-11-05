// 予約サイト内アンケートの共通処理（設問の型、分岐の判定、集計）。
// 分岐の判定は DB の validate_survey_answers と同じ規則にそろえること。

export type SurveyQuestionType = 'text' | 'single' | 'multiple' | 'rating';

/** 前の設問の答えが values のどれかに当たったときだけ表示する */
export type SurveyShowIf = { question_id: string; values: string[] };

export type SurveyQuestion = {
  id: string;
  text: string;
  type: SurveyQuestionType;
  options?: string[];
  required?: boolean;
  show_if?: SurveyShowIf | null;
};

export type SurveyConfig = { intro?: string; questions?: SurveyQuestion[] };

export type SurveyAnswerValue = string | string[] | number;
export type SurveyAnswers = Record<string, SurveyAnswerValue | undefined>;

export const SURVEY_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  text: '自由記述',
  single: '1つ選ぶ',
  multiple: '複数選ぶ',
  rating: '5段階評価',
};

export const isChoiceQuestion = (q: Pick<SurveyQuestion, 'type'>) => q.type === 'single' || q.type === 'multiple';

function isAnswered(value: SurveyAnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  return String(value).trim() !== '';
}

/**
 * 表示する設問の id の集合を返す。
 * 条件元が非表示、または未回答なら、その設問も非表示（連鎖）。
 */
export function visibleQuestionIds(questions: SurveyQuestion[], answers: SurveyAnswers): Set<string> {
  const visible = new Set<string>();
  for (const q of questions) {
    const cond = q.show_if;
    let show = true;
    if (cond) {
      const parent = answers[cond.question_id];
      if (!visible.has(cond.question_id) || !isAnswered(parent)) show = false;
      else if (Array.isArray(parent)) show = parent.some((v) => cond.values.includes(v));
      else show = cond.values.includes(String(parent));
    }
    if (show) visible.add(q.id);
  }
  return visible;
}

/** 非表示の設問の回答を取り除く（DB でも捨てるが、送る前にそろえておく） */
export function pruneHiddenAnswers(questions: SurveyQuestion[], answers: SurveyAnswers): SurveyAnswers {
  const visible = visibleQuestionIds(questions, answers);
  return Object.fromEntries(Object.entries(answers).filter(([id, value]) => visible.has(id) && isAnswered(value)));
}

export function missingRequiredAnswer(questions: SurveyQuestion[], answers: SurveyAnswers): boolean {
  const visible = visibleQuestionIds(questions, answers);
  return questions.some((q) => q.required && visible.has(q.id) && !isAnswered(answers[q.id]));
}

export function formatSurveyAnswer(value: SurveyAnswerValue | undefined): string {
  if (value === undefined || value === null) return '';
  return Array.isArray(value) ? value.join('、') : String(value);
}

export function describeShowIf(questions: SurveyQuestion[], q: SurveyQuestion): string {
  if (!q.show_if) return '';
  const index = questions.findIndex((row) => row.id === q.show_if!.question_id);
  if (index < 0) return '';
  return `設問${index + 1}で「${q.show_if.values.join('」「')}」を選んだ人だけ`;
}

export type SurveyChoiceCount = { label: string; count: number };
export type SurveyQuestionSummary = {
  question: SurveyQuestion;
  /** この設問に答えた人数（割合の分母） */
  respondents: number;
  /** 選択式・5段階評価の内訳。自由記述は空 */
  counts: SurveyChoiceCount[];
  /** 5段階評価の平均 */
  average: number | null;
  /** 自由記述の回答 */
  texts: string[];
};

/** 回答の一覧を設問ごとに集計する。今の設定にない選択肢の回答も「（現在の選択肢にない）◯◯」として数える。 */
export function summarizeSurvey(questions: SurveyQuestion[], answersList: Array<SurveyAnswers | null | undefined>): SurveyQuestionSummary[] {
  return questions.map((question) => {
    const values = answersList.map((answers) => answers?.[question.id]).filter(isAnswered) as SurveyAnswerValue[];
    const summary: SurveyQuestionSummary = { question, respondents: values.length, counts: [], average: null, texts: [] };

    if (question.type === 'text') {
      summary.texts = values.map((v) => String(v));
      return summary;
    }

    const base = question.type === 'rating' ? ['1', '2', '3', '4', '5'] : (question.options ?? []);
    const tally = new Map<string, number>(base.map((label) => [label, 0]));
    for (const value of values) {
      for (const item of Array.isArray(value) ? value : [String(value)]) {
        tally.set(item, (tally.get(item) ?? 0) + 1);
      }
    }
    summary.counts = Array.from(tally, ([label, count]) => ({
      label: base.includes(label) ? label : `（現在の選択肢にない）${label}`,
      count,
    }));
    if (question.type === 'rating' && values.length > 0) {
      summary.average = values.reduce<number>((sum, v) => sum + Number(v), 0) / values.length;
    }
    return summary;
  });
}
