import test from 'node:test'
import assert from 'node:assert/strict'
import { isPcDevice, type DeviceSignals } from './deviceKind.ts'

const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'
const LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
// スマホで「PC版サイトを表示」にすると、AndroidでもLinuxのPCのように名乗る
const ANDROID_DESKTOP_MODE = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const pc = (overrides: Partial<DeviceSignals> = {}): DeviceSignals => ({
  userAgent: WIN_CHROME,
  maxTouchPoints: 0,
  anyCoarsePointer: false,
  screenWidth: 1920,
  screenHeight: 1080,
  ...overrides,
})

test('普通のPC（Windows・Mac・Linux）はPCと判定する', () => {
  assert.equal(isPcDevice(pc()), true)
  assert.equal(isPcDevice(pc({ userAgent: MAC_SAFARI, screenWidth: 1440, screenHeight: 900 })), true)
  assert.equal(isPcDevice(pc({ userAgent: LINUX_FIREFOX })), true)
})

test('スマホはPCと判定しない', () => {
  assert.equal(isPcDevice({ userAgent: IPHONE, maxTouchPoints: 5, anyCoarsePointer: true, screenWidth: 393, screenHeight: 852 }), false)
  assert.equal(isPcDevice({ userAgent: ANDROID, maxTouchPoints: 5, anyCoarsePointer: true, screenWidth: 412, screenHeight: 915 }), false)
})

test('スマホで「PC版サイトを表示」にしていても、タッチと画面の狭さでスマホ扱いにする', () => {
  assert.equal(isPcDevice({ userAgent: ANDROID_DESKTOP_MODE, maxTouchPoints: 5, anyCoarsePointer: true, screenWidth: 412, screenHeight: 915 }), false)
  assert.equal(isPcDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 5, anyCoarsePointer: true, screenWidth: 393, screenHeight: 852 }), false)
})

test('iPad（Macと名乗る）はタッチ対応なので制限しない', () => {
  assert.equal(isPcDevice({ userAgent: MAC_SAFARI, maxTouchPoints: 5, anyCoarsePointer: true, screenWidth: 1024, screenHeight: 1366 }), false)
})

test('タッチ対応のノートPCやタブレットは制限しない', () => {
  assert.equal(isPcDevice(pc({ maxTouchPoints: 10 })), false)
  assert.equal(isPcDevice(pc({ anyCoarsePointer: true })), false)
})

test('画面が狭ければPCのOSでも制限しない', () => {
  assert.equal(isPcDevice(pc({ screenWidth: 800, screenHeight: 600 })), false)
})

test('ブラウザが端末情報（userAgentData）を返すときはそれを優先する', () => {
  assert.equal(isPcDevice(pc({ platform: 'Windows', mobile: false })), true)
  assert.equal(isPcDevice(pc({ platform: 'Android', mobile: false })), false)
  assert.equal(isPcDevice(pc({ platform: 'Windows', mobile: true })), false)
})
