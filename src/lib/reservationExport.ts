// 予約者一覧の Excel 出力（予約者一覧・集計・アンケート統計の3シート）を組み立てる。

import { type SurveyQuestion, type SurveyQuestionSummary, describeShowIf } from '@/lib/survey';
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

/** アンケート統計：設問ごとに、選択肢ごとの人数・割合・横棒を出す（キャンセルを除く） */
export function surveyStatsSheet(questions: SurveyQuestion[], summary: SurveyQuestionSummary[]): XlsxSheet {
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
      rows.push(styledRow(['選択肢', '人数', '割合', 'グラフ'], 'header'));
      row.counts.forEach((c) => {
        const ratio = row.respondents > 0 ? c.count / row.respondents : null;
        rows.push([
          { value: c.label, style: 'wrap' },
          { value: c.count, style: 'integer' },
          { value: ratio ?? '-', style: 'percent' },
          { value: '█'.repeat(Math.round((ratio ?? 0) * 20)), style: 'bar' },
        ]);
      });
    }
    rows.push([]);
  });
  return { name: 'アンケート統計', rows, columnWidths: [56, 9, 9, 24] };
}
