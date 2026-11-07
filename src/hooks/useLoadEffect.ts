'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * deps が変わったときに、データを読み込む関数（load）を呼ぶ。
 * load は毎回の描画で作り直されてもよい（いちばん新しい load を呼ぶ）。
 * 読み込み関数の中の setState は await の後に行われるので、
 * 「effect の中で同期的に setState する」問題にはならない。
 */
export function useLoadEffect(load: () => unknown, deps: readonly unknown[]) {
  const loadRef = useRef(load);
  useLayoutEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    void loadRef.current();
    // deps は呼び出し側が渡す配列そのもの
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
