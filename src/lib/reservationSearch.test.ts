import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesReservationSearch } from './reservationSearch.ts'

const row = { student_name: '田中 太郎', student_number: 's23x123', university_email: 'tanaka@example.ac.jp' }

test('学籍番号に一致（前後の空白と大文字小文字を無視）', () => {
  assert.equal(matchesReservationSearch(row, '  S23X1 '), true)
})
test('メールに一致（大文字小文字を無視）', () => {
  assert.equal(matchesReservationSearch(row, 'TANAKA'), true)
})
test('氏名に一致', () => {
  assert.equal(matchesReservationSearch(row, '田中'), true)
})
test('どれにも含まれなければ不一致', () => {
  assert.equal(matchesReservationSearch(row, 'zzz'), false)
})
test('空の検索は全件一致', () => {
  assert.equal(matchesReservationSearch(row, ''), true)
  assert.equal(matchesReservationSearch(row, '   '), true)
})
