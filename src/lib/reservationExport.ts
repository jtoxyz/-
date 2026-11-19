// 予約者一覧の Excel 出力（予約者一覧・集計・学部と学年・アンケート統計）を組み立てる。

import { type SurveyAnswers, type SurveyQuestion, type SurveyQuestionSummary, breakdownByCondition, describeShowIf } from '@/lib/survey';
import { GRADE_LABELS, facultyLabel, gradeAt, gradeLabel } from '@/lib/studentProfile';
import { type XlsxCell, type XlsxSheet, styledRow } from '@/lib/xlsx';

export type ExportReservation = {
  event_slot_id: string | null;
  student_name: string;
  student_number: string;
  university_email: string;
  status: 'reserved' | 'used' | 'cancelled';
  payment_status: string;
  ticket_type: 'reservation' | 'walkin';
  ticket_code: string;
  used_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  event_slots: { label: string } | null;
  event_ticket_options: { label: string; price_yen: number } | null;
};
export type ExportSlot = { id: string };

export const PAYMENT_LABEL: Record<string, string> = { not_required: '不要', pending: '未払い', paid: '支払い済み', expired: '期限切れ' };

export function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Asia/Tokyo',
  });
}

export function summaryNote(questions: SurveyQuestion[], row: SurveyQuestionSummary): string {
  const parts = [`回答 ${row.respondents}人`];
  if (row.question.type === 'multiple') parts.push('複数回答（割合は回答者に対する割合）');
  if (row.average !== null) parts.push(`平均 ${row.average.toFixed(2)}`);
  const cond = describeShowIf(questions, row.question);
  if (cond) parts.push(`${cond}に表示`);
  return parts.join('・');
}

const STATUS_LABEL = { reserved: '有効', used: '使用済み', cancelled: 'キャンセル' } as const;
const TYPE_LABEL = { reservation: '予約券', walkin: '当日券' } as const;

/** 開催枠の並び順（設定順）。枠なしは最後 */
function slotOrder(slots: ExportSlot[]): (slotId: string | null) => number {
  const order = new Map(slots.map((slot, i) => [slot.id, i]));
  return (slotId) => (slotId ? order.get(slotId) ?? slots.length : slots.length + 1);
}

/** 予約者一覧：開催枠 → 学籍番号の順。キャンセルは各枠の最後に灰色で出す */
export function reservationListSheet(reservations: ExportReservation[], slots: ExportSlot[]): XlsxSheet {
  const hasOptions = reservations.some((res) => res.event_ticket_options);
  const orderOf = slotOrder(slots);
  const sorted = [...reservations].sort((a, b) =>
    orderOf(a.event_slot_id) - orderOf(b.event_slot_id)
    || Number(a.status === 'cancelled') - Number(b.status === 'cancelled')
    || a.student_number.localeCompare(b.student_number, 'ja', { numeric: true }));
  const headers = [
    'No.', '開催枠', '券種', ...(hasOptions ? ['券種名', '金額（円）'] : []), '氏名', '学籍番号', '大学メール', '状態', '支払い',
    '申込日時', '使用日時', '取消日時', 'チケットコード',
  ];
  const rows = sorted.map((res, i) => styledRow([
    i + 1, res.event_slots?.label || '-', TYPE_LABEL[res.ticket_type],
    ...(hasOptions ? [res.event_ticket_options?.label ?? '', res.event_ticket_options?.price_yen ?? ''] : []),
    res.student_name, res.student_number, res.university_email, STATUS_LABEL[res.status], PAYMENT_LABEL[res.payment_status] ?? res.payment_status,
    formatDateTime(res.created_at), res.used_at ? formatDateTime(res.used_at) : '', res.cancelled_at ? formatDateTime(res.cancelled_at) : '', res.ticket_code,
  ], res.status === 'cancelled' ? 'muted' : 'body'));
  return { name: '予約者一覧', rows: [styledRow(headers, 'header'), ...rows], freezeRows: 1, autoFilterRow: 0, landscape: true };
}

/** 集計：開催枠ごとの人数と、券種ごとの人数・金額 */
export function totalsSheet(eventTitle: string, reservations: ExportReservation[], slots: ExportSlot[]): XlsxSheet {
  const now = new Date().toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
  const rows: XlsxCell[][] = [
    [{ value: eventTitle, style: 'title' }],
    [{ value: `出力日時：${now}（日本時間）`, style: 'note' }],
    [],
    [{ value: '開催枠ごとの人数', style: 'bold' }],
    styledRow(['開催枠', '予約券', '当日券', '合計', '使用済み', '未使用', 'キャンセル'], 'header'),
  ];

  const orderOf = slotOrder(slots);
  const slotGroups = new Map<string, { label: string; order: number; items: ExportReservation[] }>();
  for (const res of reservations) {
    const key = res.event_slot_id ?? '';
    if (!slotGroups.has(key)) slotGroups.set(key, { label: res.event_slots?.label || '-', order: orderOf(res.event_slot_id), items: [] });
    slotGroups.get(key)!.items.push(res);
  }
  const slotCounts = (items: ExportReservation[]) => {
    const active = items.filter((r) => r.status !== 'cancelled');
    const used = active.filter((r) => r.status === 'used').length;
    return [
      active.filter((r) => r.ticket_type === 'reservation').length, active.filter((r) => r.ticket_type === 'walkin').length,
      active.length, used, active.length - used, items.length - active.length,
    ];
  };
  [...slotGroups.values()].sort((a, b) => a.order - b.order).forEach((group) => {
    rows.push([{ value: group.label, style: 'body' }, ...styledRow(slotCounts(group.items), 'integer')]);
  });
  rows.push(styledRow(['合計', ...slotCounts(reservations)], 'section'));
  rows.push([{ value: '「合計」「使用済み」「未使用」はキャンセルを除いた人数です。', style: 'note' }]);

  const optionGroups = new Map<string, { price: number; items: ExportReservation[] }>();
  for (const res of reservations) {
    if (!res.event_ticket_options || res.status === 'cancelled') continue;
    const { label, price_yen } = res.event_ticket_options;
    if (!optionGroups.has(label)) optionGroups.set(label, { price: price_yen, items: [] });
    optionGroups.get(label)!.items.push(res);
  }
  if (optionGroups.size > 0) {
    rows.push([], [{ value: '券種ごとの人数と金額', style: 'bold' }]);
    rows.push(styledRow(['券種名', '金額（円）', '人数', '支払い済み', '未払い', '支払い済み金額（円）'], 'header'));
    const total = [0, 0, 0, 0];
    optionGroups.forEach((group, label) => {
      const paid = group.items.filter((r) => r.payment_status === 'paid').length;
      const pending = group.items.filter((r) => r.payment_status === 'pending').length;
      const counts = [group.items.length, paid, pending, paid * group.price];
      counts.forEach((n, i) => { total[i] += n; });
      rows.push([{ value: label, style: 'body' }, ...styledRow([group.price, ...counts], 'integer')]);
    });
    rows.push(styledRow(['合計', '', ...total], 'section'));
    rows.push([{ value: 'キャンセルを除いた人数です。', style: 'note' }]);
  }
  return { name: '集計', rows, columnWidths: [28, 12, 12, 12, 12, 22, 12] };
}

/** 選択肢ごとの人数・割合・横棒の表 */
function choiceTableRows(row: SurveyQuestionSummary): XlsxCell[][] {
  const rows: XlsxCell[][] = [styledRow(['選択肢', '人数', '割合', 'グラフ'], 'header')];
  row.counts.forEach((c) => {
    const ratio = row.respondents > 0 ? c.count / row.respondents : null;
    rows.push([
      { value: c.label, style: 'wrap' },
      { value: c.count, style: 'integer' },
      { value: ratio ?? '-', style: 'percent' },
      { value: '█'.repeat(Math.round((ratio ?? 0) * 20)), style: 'bar' },
    ]);
  });
  return rows;
}

/**
 * アンケート統計：設問ごとに、選択肢ごとの人数・割合・横棒を出す（キャンセルを除く）。
 * 「前の設問で A か B を選んだ人だけ」の設問は、全体に加えて A・B それぞれの内訳も出す。
 */
export function surveyStatsSheet(
  questions: SurveyQuestion[],
  summary: SurveyQuestionSummary[],
  answersList: Array<SurveyAnswers | null | undefined> = [],
): XlsxSheet {
  const rows: XlsxCell[][] = [
    [{ value: 'アンケート統計', style: 'title' }],
    [{ value: 'キャンセルを除いた予約の回答を集計しています。', style: 'note' }],
    [],
  ];
  summary.forEach((row, index) => {
    rows.push(styledRow([`Q${index + 1}. ${row.question.text}`, '', '', ''], 'section'));
    rows.push([{ value: summaryNote(questions, row), style: 'note' }]);
    if (row.question.type === 'text') {
      if (row.texts.length === 0) rows.push([{ value: '回答はありません', style: 'note' }]);
      row.texts.forEach((text) => rows.push([{ value: text, style: 'wrap' }]));
    } else {
      rows.push(...choiceTableRows(row));
      const breakdown = breakdownByCondition(questions, row.question, answersList);
      if (breakdown) {
        const parentNo = questions.findIndex((q) => q.id === breakdown.parent.id) + 1;
        breakdown.groups.forEach((group) => {
          rows.push([]);
          rows.push([{ value: `▼ Q${parentNo}で「${group.value}」を選んだ人（回答 ${group.summary.respondents}人）`, style: 'bold' }]);
          rows.push(...choiceTableRows(group.summary));
        });
        rows.push([{ value: `Q${parentNo}で複数選んだ人は、それぞれの内訳に数えています。`, style: 'note' }]);
      }
    }
    rows.push([]);
  });
  return { name: 'アンケート統計', rows, columnWidths: [56, 9, 9, 24] };
}

/** 学部と学年：何学部・何年生が多いか、学部ごとの学年の内訳（キャンセルを除き、同じ学籍番号は1人として数える） */
export function facultyGradeSheet(reservations: ExportReservation[]): XlsxSheet {
  const students = new Map<string, { faculty: string; grade: string }>();
  for (const res of reservations) {
    if (res.status === 'cancelled') continue;
    const key = res.student_number.trim().toUpperCase();
    if (students.has(key)) continue;
    students.set(key, { faculty: facultyLabel(key), grade: gradeLabel(gradeAt(key, new Date(res.created_at))) });
  }
  const list = [...students.values()];
  const total = list.length;

  const rankTable = (title: string, header: string, labels: string[], keyOf: (s: { faculty: string; grade: string }) => string, sortByCount: boolean) => {
    const counts = new Map<string, number>(labels.map((l) => [l, 0]));
    list.forEach((s) => counts.set(keyOf(s), (counts.get(keyOf(s)) ?? 0) + 1));
    let entries = [...counts].filter(([label, n]) => n > 0 || (!sortByCount && label !== '不明'));
    if (sortByCount) entries = entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
    const out: XlsxCell[][] = [[{ value: title, style: 'bold' }], styledRow([header, '人数', '割合', 'グラフ'], 'header')];
    entries.forEach(([label, n]) => {
      const ratio = total > 0 ? n / total : null;
      out.push([
        { value: label, style: 'body' },
        { value: n, style: 'integer' },
        { value: ratio ?? '-', style: 'percent' },
        { value: '█'.repeat(Math.round((ratio ?? 0) * 20)), style: 'bar' },
      ]);
    });
    out.push(styledRow(['合計', total, total > 0 ? 1 : '-', ''], 'section'));
    return out;
  };

  const rows: XlsxCell[][] = [
    [{ value: '学部と学年', style: 'title' }],
    [{ value: 'キャンセルを除いた予約者を、学籍番号から読み取って集計しています（同じ学籍番号は1人）。学年は申込日時点です。', style: 'note' }],
    [],
    ...rankTable('学部ごとの人数（多い順）', '学部', [], (s) => s.faculty, true),
    [],
    ...rankTable('学年ごとの人数', '学年', [...GRADE_LABELS], (s) => s.grade, false),
    [],
  ];

  // 学部 × 学年
  const grades = GRADE_LABELS.filter((g) => g !== '不明' || list.some((s) => s.grade === '不明'));
  const faculties = [...new Set(list.map((s) => s.faculty))]
    .map((f) => ({ f, n: list.filter((s) => s.faculty === f).length }))
    .sort((a, b) => b.n - a.n || a.f.localeCompare(b.f, 'ja'));
  const cell = (f: string | null, g: string | null) => list.filter((s) => (f === null || s.faculty === f) && (g === null || s.grade === g)).length;

  rows.push([{ value: '学部ごとの学年の内訳（人数）', style: 'bold' }]);
  rows.push(styledRow(['学部', ...grades, '合計', '最も多い学年'], 'header'));
  faculties.forEach(({ f, n }) => {
    const counts = grades.map((g) => cell(f, g));
    const max = Math.max(...counts);
    const top = max > 0 ? grades.filter((_, i) => counts[i] === max).join('・') : '-';
    rows.push([{ value: f, style: 'body' }, ...styledRow([...counts, n], 'integer'), { value: top, style: 'body' }]);
  });
  rows.push(styledRow(['合計', ...grades.map((g) => cell(null, g)), total, ''], 'section'));
  rows.push([]);

  rows.push([{ value: '学部ごとの学年の内訳（学部内の割合）', style: 'bold' }]);
  rows.push(styledRow(['学部', ...grades], 'header'));
  faculties.forEach(({ f, n }) => {
    rows.push([{ value: f, style: 'body' }, ...grades.map((g) => ({ value: n > 0 ? cell(f, g) / n : '-', style: 'percent' as const }))]);
  });
  rows.push([{ value: '各行の合計が100%になります。学部によって学年の偏りがあるかを比べられます。', style: 'note' }]);

  return { name: '学部と学年', rows, columnWidths: [24, 10, 10, 10, 10, 10, 10, 10, 14] };
}
