import test from 'node:test'
import assert from 'node:assert/strict'
import {
  alreadyPaidMessage,
  deskTodayFromSummary,
  deskViewFromFind,
  dropMissed,
  formatYenTotal,
  looksLikeImeInput,
  nextMissedList,
  isOutsideVisitWindows,
  pendingVisitWindows,
  reservationTokenFromScan,
  sameReservationIds,
  staffPaymentQrUrl,
  unavailableMessage,
  type FindReservation,
  type DeskView,
  type FindResult,
  type MissedEntry,
  type PaymentSummary,
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

test('reservationTokenFromScan: 大文字URL・ハイフン類・UUID複数', () => {
  assert.equal(reservationTokenFromScan(`HTTPS://EXAMPLE.COM/STAFF?R=${UUID.toUpperCase()}`), UUID)
  assert.equal(reservationTokenFromScan(UUID.replaceAll('-', '\u2212')), UUID)
  assert.equal(reservationTokenFromScan(UUID.replaceAll('-', '\u30fc')), UUID)
  assert.equal(reservationTokenFromScan(UUID.replaceAll('-', '\u2013')), UUID)
  const other = '11111111-2222-4333-8444-555555555555'
  assert.equal(reservationTokenFromScan(`${UUID} ${other}`), UUID)
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

test('deskViewFromFind: cancelled', () => {
  assert.deepEqual(
    deskViewFromFind({ status: 'cancelled', student_name: '山田太郎', student_number: '24B123' }),
    { kind: 'unavailable', reason: 'cancelled', studentName: '山田太郎' },
  )
})

test('deskViewFromFind: 受領できる予約も支払い済みもない（期限切れ・支払い不要）は受領不可', () => {
  const expired = deskViewFromFind(found([res({ payment_status: 'expired', status: 'reserved' })]))
  assert.deepEqual(expired, { kind: 'unavailable', reason: 'expired', studentName: '山田太郎' })
  const notRequired = deskViewFromFind(found([res({ payment_status: 'not_required', status: 'reserved' })]))
  assert.equal(notRequired.kind, 'unavailable')
  assert.equal(deskViewFromFind(found([])).kind, 'unavailable')
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

test('formatYenTotal: 0円も金額で出す', () => {
  assert.equal(formatYenTotal(0), '0円')
  assert.equal(formatYenTotal(41500), '41,500円')
  assert.equal(formatYenTotal(-1000), '-1,000円')
})

test('alreadyPaidMessage', () => {
  assert.equal(alreadyPaidMessage({ byMe: true, time: '12:31', receivedByName: '係A' }), '支払い済み（今あなたが受領 12:31）')
  assert.equal(
    alreadyPaidMessage({ byMe: false, time: '12:31', receivedByName: '山田' }),
    '12:31 に山田さんが受領済み。受け取らないでください',
  )
  assert.equal(
    alreadyPaidMessage({ byMe: false, time: '09:05', receivedByName: null }),
    '支払い済み（09:05、学生のQR読み取りまたは管理画面）。受け取らないでください',
  )
  assert.equal(
    alreadyPaidMessage({ byMe: false, time: '', receivedByName: null }),
    '支払い済み（時刻不明、学生のQR読み取りまたは管理画面）。受け取らないでください',
  )
})

test('unavailableMessage', () => {
  assert.equal(unavailableMessage('expired'), '期限切れでキャンセルされています。受領できません。管理者に回してください')
  assert.equal(unavailableMessage('cancelled'), 'キャンセル済みです。受領できません。管理者に回してください')
})

test('pendingVisitWindows: 未払いの枠だけ、重複をまとめて開始順', () => {
  const w1 = { visit_starts_at: '2026-11-26T03:00:00Z', visit_ends_at: '2026-11-26T03:30:00Z', visit_location: null }
  const w2 = { visit_starts_at: '2026-11-26T02:00:00Z', visit_ends_at: '2026-11-26T02:30:00Z', visit_location: '101' }
  const windows = pendingVisitWindows([
    res({ reservation_id: 'a', ...w1 }),
    res({ reservation_id: 'b', ...w1 }),
    res({ reservation_id: 'c', ...w2 }),
    res({ reservation_id: 'd', payment_status: 'paid', visit_starts_at: '2026-11-26T00:00:00Z', visit_ends_at: '2026-11-26T00:30:00Z' }),
    res({ reservation_id: 'e' }),
  ])
  assert.deepEqual(windows, [
    { starts_at: w2.visit_starts_at, ends_at: w2.visit_ends_at, location: '101' },
    { starts_at: w1.visit_starts_at, ends_at: w1.visit_ends_at, location: null },
  ])
})

test('isOutsideVisitWindows', () => {
  const windows = [{ starts_at: '2026-11-26T03:00:00Z', ends_at: '2026-11-26T03:30:00Z', location: null }]
  assert.equal(isOutsideVisitWindows([], Date.parse('2026-11-26T09:00:00Z')), false)
  assert.equal(isOutsideVisitWindows(windows, Date.parse('2026-11-26T03:10:00Z')), false)
  assert.equal(isOutsideVisitWindows(windows, Date.parse('2026-11-26T03:30:00Z')), false)
  assert.equal(isOutsideVisitWindows(windows, Date.parse('2026-11-26T02:59:00Z')), true)
  assert.equal(isOutsideVisitWindows(windows, Date.parse('2026-11-26T03:31:00Z')), true)
})

type SummaryItem = PaymentSummary['items'][number]
function item(over: Partial<SummaryItem>): SummaryItem {
  return {
    receipt_id: 'p1',
    created_at: '2026-11-26T03:00:00Z',
    action: 'received',
    reservation_id: 'r1',
    student_name: '佐藤花子',
    student_number: '24B001',
    ticket_option_label: '一般',
    amount_yen: 1000,
    operator_name: '係A',
    attributed_user_id: 'me',
    reversed: false,
    ...over,
  }
}
function operator(id: string | null, net_count: number, net_yen: number): PaymentSummary['operators'][number] {
  return {
    operator_user_id: id,
    operator_name: id,
    received_count: net_count,
    received_yen: net_yen,
    undone_count: 0,
    undone_yen: 0,
    net_count,
    net_yen,
  }
}

test('deskTodayFromSummary: 管理者は自分の行と自分の明細だけ、先頭5件', () => {
  const summary: PaymentSummary = {
    date: '2026-11-26',
    operators: [operator('other', 9, 9000), operator('me', 2, 2500), operator(null, -1, -1000)],
    total: { net_count: 11, net_yen: 11500 },
    items: [
      item({ receipt_id: 'x', attributed_user_id: 'other' }),
      ...['1', '2', '3', '4', '5', '6'].map((id) => item({ receipt_id: id })),
      item({ receipt_id: 'n', action: 'undone', attributed_user_id: null }),
    ],
  }
  const today = deskTodayFromSummary(summary, 'me', true)
  assert.equal(today.netCount, 2)
  assert.equal(today.netYen, 2500)
  assert.deepEqual(today.recent.map((i) => i.receipt_id), ['1', '2', '3', '4', '5'])
})

test('deskTodayFromSummary: 自分の行がなければ0、集計なしも0', () => {
  const summary: PaymentSummary = {
    date: '2026-11-26',
    operators: [operator('other', 3, 3000)],
    total: { net_count: 3, net_yen: 3000 },
    items: [item({ attributed_user_id: 'other' })],
  }
  assert.deepEqual(deskTodayFromSummary(summary, 'me', true), { netCount: 0, netYen: 0, recent: [] })
  assert.deepEqual(deskTodayFromSummary(null, 'me', false), { netCount: 0, netYen: 0, recent: [] })
})

test('deskTodayFromSummary: uid が取れないとき、スタッフは自分の分（集計そのもの）、管理者は出さない', () => {
  const summary: PaymentSummary = {
    date: '2026-11-26',
    operators: [operator('me', 1, 500)],
    total: { net_count: 1, net_yen: 500 },
    items: [item({})],
  }
  assert.equal(deskTodayFromSummary(summary, null, false).netYen, 500)
  assert.equal(deskTodayFromSummary(summary, null, false).recent.length, 1)
  assert.deepEqual(deskTodayFromSummary(summary, null, true), { netCount: 0, netYen: 0, recent: [] })
})

test('sameReservationIds', () => {
  assert.equal(sameReservationIds(['a', 'b'], ['b', 'a']), true)
  assert.equal(sameReservationIds(['a'], ['a', 'b']), false)
  assert.equal(sameReservationIds(['a', 'c'], ['a', 'b']), false)
})

test('looksLikeImeInput', () => {
  assert.equal(looksLikeImeInput('ｈっｔｐｓ：／／'), true)
  assert.equal(looksLikeImeInput('4でえ369c'), true)
  assert.equal(looksLikeImeInput(`https://example.com/staff?r=${UUID}`), false)
  assert.equal(looksLikeImeInput('ｈｔｔｐｓ'), false)
})

function pendingView(ids: string[], name = '田中'): DeskView {
  return {
    kind: 'pending',
    studentName: name,
    studentNumber: '24B999',
    reservationIds: ids,
    totalYen: 1500,
    reservations: [],
    paidCount: 0,
  }
}

test('nextMissedList: 未払い表示中に別の人を読んだら、前の人を先頭に残す', () => {
  const list = nextMissedList([], { view: pendingView(['a'], '田中'), scannedAt: 100 }, pendingView(['b'], '佐藤'))
  assert.deepEqual(list, [
    { key: 'a', studentName: '田中', studentNumber: '24B999', reservationIds: ['a'], totalYen: 1500, scannedAt: 100 },
  ])
})

test('nextMissedList: 同じ人を読み直したら残さない', () => {
  assert.deepEqual(nextMissedList([], { view: pendingView(['a', 'b']), scannedAt: 1 }, pendingView(['b', 'a'])), [])
})

test('nextMissedList: 前が未払いでなければ何も足さない。見つからない等でも前の未払いは残す', () => {
  assert.deepEqual(nextMissedList([], { view: { kind: 'not_found' }, scannedAt: 1 }, pendingView(['a'])), [])
  assert.deepEqual(nextMissedList([], null, { kind: 'not_found' }), [])
  assert.equal(nextMissedList([], { view: pendingView(['a']), scannedAt: 1 }, { kind: 'not_found' }).length, 1)
})

test('nextMissedList: 残っていた人をもう一度読んだら、その行は消える。上限で古い行を落とす', () => {
  const old: MissedEntry[] = [
    { key: 'x', studentName: 'X', studentNumber: '1', reservationIds: ['x'], totalYen: 1, scannedAt: 1 },
    { key: 'y', studentName: 'Y', studentNumber: '2', reservationIds: ['y'], totalYen: 1, scannedAt: 2 },
  ]
  const list = nextMissedList(old, { view: pendingView(['a']), scannedAt: 3 }, pendingView(['x']), 2)
  assert.deepEqual(list.map((m) => m.key), ['a', 'y'])
  assert.deepEqual(nextMissedList(old, null, pendingView(['y'])).map((m) => m.key), ['x'])
})

test('dropMissed', () => {
  const list: MissedEntry[] = [
    { key: 'a,b', studentName: 'A', studentNumber: '1', reservationIds: ['a', 'b'], totalYen: 1, scannedAt: 1 },
    { key: 'c', studentName: 'C', studentNumber: '2', reservationIds: ['c'], totalYen: 1, scannedAt: 2 },
  ]
  assert.deepEqual(dropMissed(list, ['b']).map((m) => m.key), ['c'])
})
