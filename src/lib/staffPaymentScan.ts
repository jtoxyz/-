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
