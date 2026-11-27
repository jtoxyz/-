'use client';

import { useSyncExternalStore } from 'react';
import { isPcDevice, readDeviceSignals } from '@/lib/deviceKind';

const noopSubscribe = () => () => {};

let cached: boolean | null = null;
function getSnapshot(): boolean {
  if (cached === null) {
    const signals = readDeviceSignals();
    cached = signals ? isPcDevice(signals) : false;
  }
  return cached;
}

/** PCで開いているか（サーバー描画では false。ブラウザで描き直す） */
export function useIsPcDevice(): boolean {
  return useSyncExternalStore(noopSubscribe, getSnapshot, () => false);
}
