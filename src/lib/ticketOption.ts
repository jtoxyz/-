/** 金額を「100円」「無料」の形にする */
export function formatYen(priceYen: number): string {
  return priceYen === 0 ? '無料' : `${priceYen.toLocaleString('ja-JP')}円`;
}

/** 券種を「アンケート回答（100円）」の形で表示する。券種がない予約は null。 */
export function formatTicketOption(label: string | null | undefined, priceYen: number | null | undefined): string | null {
  if (!label) return null;
  if (priceYen == null) return label;
  return `${label}（${formatYen(priceYen)}）`;
}
