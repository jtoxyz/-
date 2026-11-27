/**
 * 受付・受取をスマホだけに限るための「PCかどうか」の判定。
 *
 * 次の3つが全部そろったときだけPCとみなす。どれか1つでも外れたらスマホ扱い（制限しない）。
 *   1. OSがWindows・Mac・Linux（ChromeOSを含む）。AndroidやiPhone・iPadは対象外
 *   2. タッチ操作ができない（タッチ対応のノートPCやタブレットは制限しない）
 *   3. 画面が広い（端末の画面の長い辺が1024px以上。ウィンドウを縮めても変わらない）
 *
 * スマホをPCと間違えてチケットが出ない、を避けるため、迷ったらスマホ扱いにする。
 * 開発者ツールでスマホのふりをされるとすり抜けるが、そこは受付で目視して止める前提。
 */

export type DeviceSignals = {
  userAgent: string;
  /** navigator.userAgentData.platform（対応ブラウザのみ） */
  platform?: string | null;
  /** navigator.userAgentData.mobile（対応ブラウザのみ） */
  mobile?: boolean | null;
  maxTouchPoints: number;
  /** matchMedia('(any-pointer: coarse)').matches */
  anyCoarsePointer: boolean;
  screenWidth: number;
  screenHeight: number;
};

export const PC_MIN_SCREEN_LONG_SIDE = 1024;

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i;
const PC_UA = /Windows NT|Macintosh|Mac OS X|CrOS|Linux|X11/i;
const PC_PLATFORM = /^(Windows|macOS|Linux|Chrome OS|ChromeOS)$/i;

function isPcOs(signals: DeviceSignals): boolean {
  if (signals.mobile === true) return false;
  if (MOBILE_UA.test(signals.userAgent)) return false;
  if (signals.platform) return PC_PLATFORM.test(signals.platform);
  return PC_UA.test(signals.userAgent);
}

function hasTouch(signals: DeviceSignals): boolean {
  return signals.maxTouchPoints > 0 || signals.anyCoarsePointer;
}

function hasWideScreen(signals: DeviceSignals): boolean {
  return Math.max(signals.screenWidth, signals.screenHeight) >= PC_MIN_SCREEN_LONG_SIDE;
}

export function isPcDevice(signals: DeviceSignals): boolean {
  return isPcOs(signals) && !hasTouch(signals) && hasWideScreen(signals);
}

/** ブラウザから判定材料を集める。取れないときは null（＝制限しない）。 */
export function readDeviceSignals(): DeviceSignals | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  let anyCoarsePointer = false;
  try {
    anyCoarsePointer = window.matchMedia?.('(any-pointer: coarse)').matches ?? false;
  } catch {
    anyCoarsePointer = false;
  }
  return {
    userAgent: navigator.userAgent || '',
    platform: uaData?.platform ?? null,
    mobile: uaData?.mobile ?? null,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    anyCoarsePointer,
    screenWidth: window.screen?.width || 0,
    screenHeight: window.screen?.height || 0,
  };
}

/** 受付・受取はスマホのみ、の案内文（予約画面・自分の予約・チケット画面で共通） */
export const SMARTPHONE_ONLY_NOTICE = '受付・受取はスマホのみです。PCではチケットを表示できません（タブレットは使えます）。';
