// 受付画面（/staff）用の純粋関数。import を持たないので node:test から直接実行できる。

export type PaymentConfirmMode = 'student_scan' | 'staff'

export type FindReservation = {
  reservation_id: string
  ticket_option_label: string | null
  amount_yen: number
  slot_label: string | null
  slot_starts_at: string | null
  status: string
  payment_status: string
  payment_due_at: string | null
  paid_at: string | null
  received_at: string | null
  received_by_name: string | null
  received_by_me: boolean
  visit_starts_at: string | null
  visit_ends_at: string | null
  visit_location: string | null
}

export type FindResult =
  | { status: 'not_found' }
  | { status: 'other_event'; event_id: string; event_title: string }
  | { status: 'expired' | 'cancelled'; student_name: string; student_number: string }
  | {
      status: 'found'
      event_id: string
      event_title: string
      student_name: string
      student_number: string
      pending_total_yen: number
      reservations: FindReservation[]
    }

export type ReceiveResult = {
  received: { reservation_id: string; amount_yen: number }[]
  already_paid: { reservation_id: string; paid_at: string | null; received_by_name: string | null }[]
  unavailable: string[]
  received_count: number
  received_total_yen: number
}

export type UndoResult = {
  reservation_id: string
  amount_yen: number
  will_expire: boolean
}

export type PaymentSummary = {
  date: string
  operators: {
    operator_user_id: string | null
    operator_name: string | null
    received_count: number
    received_yen: number
    undone_count: number
    undone_yen: number
    net_count: number
    net_yen: number
  }[]
  total: { net_count: number; net_yen: number }
  items: {
    receipt_id: string
    created_at: string
    action: 'received' | 'undone'
    reservation_id: string
    student_name: string | null
    student_number: string | null
    ticket_option_label: string | null
    amount_yen: number
    operator_name: string | null
    attributed_user_id: string | null
    reversed: boolean
  }[]
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

// USBスキャナは全角や記号の化けた文字列を返すことがあるので、正規化してから最初のUUIDを探す。
export function reservationTokenFromScan(text: string): string | null {
  const m = UUID_RE.exec(text.normalize('NFKC').toLowerCase())
  return m ? m[0] : null
}

export function staffPaymentQrUrl(origin: string, publicToken: string): string {
  return `${origin}/staff?r=${encodeURIComponent(publicToken)}`
}

export type DeskView =
  | { kind: 'not_a_qr' }
  | { kind: 'not_found' }
  | { kind: 'other_event'; eventTitle: string }
  | { kind: 'unavailable'; reason: 'expired' | 'cancelled'; studentName: string }
  | {
      kind: 'pending'
      studentName: string
      studentNumber: string
      reservationIds: string[]
      totalYen: number
      reservations: FindReservation[]
      paidCount: number
    }
  | {
      kind: 'already_paid'
      studentName: string
      studentNumber: string
      byMe: boolean
      receivedAt: string | null
      receivedByName: string | null
      paidAt: string | null
    }

export function deskViewFromFind(result: FindResult): DeskView {
  switch (result.status) {
    case 'not_found':
      return { kind: 'not_found' }
    case 'other_event':
      return { kind: 'other_event', eventTitle: result.event_title }
    case 'expired':
    case 'cancelled':
      return { kind: 'unavailable', reason: result.status, studentName: result.student_name }
    case 'found': {
      const pending = result.reservations.filter(
        (r) => r.payment_status === 'pending' && r.status === 'reserved',
      )
      const paid = result.reservations.filter((r) => r.payment_status === 'paid')
      if (pending.length > 0) {
        return {
          kind: 'pending',
          studentName: result.student_name,
          studentNumber: result.student_number,
          reservationIds: pending.map((r) => r.reservation_id),
          totalYen: pending.reduce((sum, r) => sum + r.amount_yen, 0),
          reservations: result.reservations,
          paidCount: paid.length,
        }
      }
      const latest = paid.reduce<FindReservation | null>(
        (best, r) =>
          best === null || Date.parse(r.paid_at ?? '') > Date.parse(best.paid_at ?? '') ? r : best,
        null,
      )
      return {
        kind: 'already_paid',
        studentName: result.student_name,
        studentNumber: result.student_number,
        byMe: latest?.received_by_me ?? false,
        receivedAt: latest?.received_at ?? null,
        receivedByName: latest?.received_by_name ?? null,
        paidAt: latest?.paid_at ?? null,
      }
    }
  }
}

// ---- 受付画面の表示まわり（時刻は呼び出し側で Asia/Tokyo の「HH:mm」にしてから渡す） ----

/** 金額の合計表示。formatYen と違い 0 円を「無料」にしない（集計・照合用） */
export function formatYenTotal(yen: number): string {
  return `${yen.toLocaleString('ja-JP')}円`
}

/** 支払い済みの人を読んだときの文言。time は日本時間の「HH:mm」（不明なら空文字） */
export function alreadyPaidMessage(p: { byMe: boolean; time: string; receivedByName: string | null }): string {
  const at = p.time || '時刻不明'
  if (p.byMe) return `支払い済み（今あなたが受領 ${at}）`
  if (p.receivedByName) return `${at} に${p.receivedByName}さんが受領済み。受け取らないでください`
  return `支払い済み（${at}、学生のQR読み取りまたは管理画面）。受け取らないでください`
}

export function unavailableMessage(reason: 'expired' | 'cancelled'): string {
  return `${reason === 'expired' ? '期限切れでキャンセルされています' : 'キャンセル済みです'}。受領できません。管理者に回してください`
}

export type VisitWindow = { starts_at: string; ends_at: string; location: string | null }

/** 未払い（これから受け取る）予約の支払い受付枠。同じ枠は1つにまとめ、開始順に並べる */
export function pendingVisitWindows(reservations: FindReservation[]): VisitWindow[] {
  const seen = new Map<string, VisitWindow>()
  for (const r of reservations) {
    if (r.status !== 'reserved' || r.payment_status !== 'pending') continue
    if (!r.visit_starts_at || !r.visit_ends_at) continue
    const key = `${r.visit_starts_at}|${r.visit_ends_at}|${r.visit_location ?? ''}`
    if (!seen.has(key)) {
      seen.set(key, { starts_at: r.visit_starts_at, ends_at: r.visit_ends_at, location: r.visit_location })
    }
  }
  return [...seen.values()].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))
}

/** 枠があり、今がどの枠にも入っていなければ true（枠がなければ時間外とは言わない） */
export function isOutsideVisitWindows(windows: VisitWindow[], nowMs: number): boolean {
  if (windows.length === 0) return false
  return !windows.some((w) => Date.parse(w.starts_at) <= nowMs && nowMs <= Date.parse(w.ends_at))
}

export type DeskToday = {
  netCount: number
  netYen: number
  recent: PaymentSummary['items']
}

/**
 * 受付画面の「今日の受付」と直前の数件。自分の分だけを使う。
 * スタッフの集計は元から自分の分だけなので、uid が取れなくてもそのまま使う。管理者は uid が取れなければ出さない。
 */
export function deskTodayFromSummary(
  summary: PaymentSummary | null,
  uid: string | null,
  isAdmin: boolean,
  limit = 5,
): DeskToday {
  if (!summary) return { netCount: 0, netYen: 0, recent: [] }
  const mine = (id: string | null) => id !== null && (uid ? id === uid : !isAdmin)
  const row = summary.operators.find((o) => mine(o.operator_user_id))
  return {
    netCount: row?.net_count ?? 0,
    netYen: row?.net_yen ?? 0,
    recent: summary.items.filter((i) => mine(i.attributed_user_id)).slice(0, limit),
  }
}

/** 2つの予約IDの並びが同じ人の同じ未払い分か（順序は問わない） */
export function sameReservationIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/** 日本語入力がオンのままスキャナーで読むと、英字がひらがな・カタカナに変わって届く */
export function looksLikeImeInput(text: string): boolean {
  return /[぀-ヿ]/.test(text)
}

/** 未払いを表示したまま次のQRが読まれた人（押し忘れ対策で直前リストに残す） */
export type MissedEntry = {
  key: string
  studentName: string
  studentNumber: string
  reservationIds: string[]
  totalYen: number
  scannedAt: number
}

const missedKey = (ids: string[]) => [...ids].sort().join(',')

/**
 * 次のQRの結果 view が出たときの「未受領（読んだだけ）」の並び。
 * - 直前に未払いを表示していて、次が同じ人の同じ未払いでなければ、その人を先頭に残す。
 * - 次に未払いとして表示する予約を含む行は消す（いま画面に出ているので）。
 */
export function nextMissedList(
  list: MissedEntry[],
  previous: { view: DeskView; scannedAt: number } | null,
  view: DeskView,
  max = 5,
): MissedEntry[] {
  let next = list
  const prev = previous?.view
  if (prev?.kind === 'pending' && !(view.kind === 'pending' && sameReservationIds(view.reservationIds, prev.reservationIds))) {
    const key = missedKey(prev.reservationIds)
    next = [
      {
        key,
        studentName: prev.studentName,
        studentNumber: prev.studentNumber,
        reservationIds: prev.reservationIds,
        totalYen: prev.totalYen,
        scannedAt: previous!.scannedAt,
      },
      ...next.filter((m) => m.key !== key),
    ]
  }
  if (view.kind === 'pending') next = dropMissed(next, view.reservationIds)
  return next.slice(0, max)
}

/** 受領した（または画面に出した）予約を含む行を消す */
export function dropMissed(list: MissedEntry[], reservationIds: string[]): MissedEntry[] {
  const ids = new Set(reservationIds)
  return list.filter((m) => !m.reservationIds.some((id) => ids.has(id)))
}
