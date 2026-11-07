'use client';

import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
};

/**
 * URL のクエリ文字列の値を読む。
 * サーバーでの事前描画と最初の描画では undefined（まだ読んでいない）、ブラウザでは値（なければ null）を返すので、
 * 「読み込み中」と「指定されていない」を区別できる。
 */
export function useQueryParam(name: string): string | null | undefined {
  return useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => undefined,
  );
}
