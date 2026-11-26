import test from 'node:test'
import assert from 'node:assert/strict'
import {
  deskViewFromFind,
  reservationTokenFromScan,
  staffPaymentQrUrl,
  type FindReservation,
  type FindResult,
} from './staffPaymentScan.ts'

const UUID = '4dee369c-003c-4568-9dcb-8802fc4923c3'

test('reservationTokenFromScan: URL', () => {
  assert.equal(reservationTokenFromScan(`https://example.com/staff?r=${UUID}`), UUID)
})

test('reservationTokenFromScan: 全角', () => {
  assert.equal(
    reservationTokenFromScan('ｈｔｔｐｓ：／／ｅｘ／ｓｔａｆｆ？ｒ＝４ＤＥＥ３６９Ｃ－００３Ｃ－４５６８－９ＤＣＢ－８８０２ＦＣ４９２３Ｃ３'),
    UUID,
  )
})

test('reservationTokenFromScan: 記号が化けたURL', () => {
  assert.equal(reservationTokenFromScan(`https*//example.com/staff_r=${UUID}\n`), UUID)
})

test('reservationTokenFromScan: QRではない文字列', () => {
  assert.equal(reservationTokenFromScan('24B123'), null)
  assert.equal(reservationTokenFromScan(''), null)
  assert.equal(reservationTokenFromScan('4dee369c-003c'), null)
})

test('staffPaymentQrUrl', () => {
  assert.equal(staffPaymentQrUrl('https://a.b', 't'), 'https://a.b/staff?r=t')
})

function res(over: Partial<FindReservation>): FindReservation {
  return {
    reservation_id: 'r1',
    ticket_option_label: '一般',
    amount_yen: 1000,
    slot_label: null,
    slot_starts_at: null,
    status: 'reserved',
    payment_status: 'pending',
    payment_due_at: null,
    paid_at: null,
    received_at: null,
    received_by_name: null,
    received_by_me: false,
    visit_starts_at: null,
    visit_ends_at: null,
    visit_location: null,
    ...over,
  }
}

function found(reservations: FindReservation[]): FindResult {
  return {
    status: 'found',
    event_id: 'e1',
    event_title: '企画',
    student_name: '山田太郎',
    student_number: '24B123',
    pending_total_yen: 0,
    reservations,
  }
}

test('deskViewFromFind: not_found / other_event / expired', () => {
  assert.deepEqual(deskViewFromFind({ status: 'not_found' }), { kind: 'not_found' })
  assert.deepEqual(
    deskViewFromFind({ status: 'other_event', event_id: 'e2', event_title: '別企画' }),
    { kind: 'other_event', eventTitle: '別企画' },
  )
  assert.deepEqual(
    deskViewFromFind({ status: 'expired', student_name: '山田太郎', student_number: '24B123' }),
    { kind: 'unavailable', reason: 'expired', studentName: '山田太郎' },
  )
})

test('deskViewFromFind: 未払いあり', () => {
  const v = deskViewFromFind(
    found([
      res({ reservation_id: 'a', amount_yen: 1500 }),
      res({ reservation_id: 'b', amount_yen: 1000 }),
      res({ reservation_id: 'c', payment_status: 'paid', paid_at: '2026-11-26T01:00:00Z' }),
    ]),
  )
  assert.equal(v.kind, 'pending')
  if (v.kind !== 'pending') return
  assert.equal(v.totalYen, 2500)
  assert.equal(v.paidCount, 1)
  assert.deepEqual(v.reservationIds, ['a', 'b'])
})

test('deskViewFromFind: 全部支払い済み（自分が受領）', () => {
  const v = deskViewFromFind(
    found([
      res({
        payment_status: 'paid',
        paid_at: '2026-11-26T01:00:00Z',
        received_at: '2026-11-26T01:00:00Z',
        received_by_name: '係A',
        received_by_me: true,
      }),
    ]),
  )
  assert.equal(v.kind, 'already_paid')
  if (v.kind !== 'already_paid') return
  assert.equal(v.byMe, true)
  assert.equal(v.receivedByName, '係A')
})

test('deskViewFromFind: 学生QRで支払い済み', () => {
  const v = deskViewFromFind(
    found([res({ payment_status: 'paid', paid_at: '2026-11-26T01:00:00Z' })]),
  )
  assert.equal(v.kind, 'already_paid')
  if (v.kind !== 'already_paid') return
  assert.equal(v.receivedByName, null)
  assert.equal(v.receivedAt, null)
  assert.equal(v.paidAt, '2026-11-26T01:00:00Z')
  assert.equal(v.byMe, false)
})
