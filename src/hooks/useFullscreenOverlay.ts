import { useEffect, useRef } from 'react';

/**
 * 全画面表示中は、背景のスクロールを止め、画面が暗くならないようにし、可能ならブラウザも全画面にする。
 * Esc やブラウザの全画面解除では onClose を呼ぶ。
 */
export function useFullscreenOverlay(open: boolean, onClose: () => void): void {
  // effect を open の変化でだけ走らせたいので、最新の onClose は ref 経由で呼ぶ
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const saved = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
      bodyOverscroll: body.style.overscrollBehavior,
    };
    // iOS Safari でも背景が動かないよう、body を固定してから元の位置に戻す
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.width = '100%';
    body.style.overscrollBehavior = 'none';

    let wakeLock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const requestWakeLock = async () => {
      try {
        const nav = navigator as Navigator & {
          wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
        };
        if (!nav.wakeLock || document.visibilityState !== 'visible') return;
        const lock = await nav.wakeLock.request('screen');
        if (cancelled) void lock.release().catch(() => {});
        else wakeLock = lock;
      } catch {}
    };
    void requestWakeLock();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVisible);

    // 対応しているブラウザ（Android Chrome など）ではアドレスバーも隠す。iPhoneでは使えないので無視する
    let enteredFullscreen = false;
    try {
      if (!document.fullscreenElement && html.requestFullscreen) {
        html.requestFullscreen({ navigationUI: 'hide' }).then(() => { enteredFullscreen = true; }).catch(() => {});
      }
    } catch {}
    const onFullscreenChange = () => {
      // 戻るジェスチャー等でブラウザの全画面が解除されたら、表示も閉じる
      if (enteredFullscreen && !document.fullscreenElement) onCloseRef.current();
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelled = true;
      html.style.overflow = saved.htmlOverflow;
      body.style.overflow = saved.bodyOverflow;
      body.style.position = saved.bodyPosition;
      body.style.top = saved.bodyTop;
      body.style.width = saved.bodyWidth;
      body.style.overscrollBehavior = saved.bodyOverscroll;
      window.scrollTo(0, scrollY);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      window.removeEventListener('keydown', onKey);
      if (wakeLock) void wakeLock.release().catch(() => {});
      if (document.fullscreenElement && document.exitFullscreen) void document.exitFullscreen().catch(() => {});
    };
  }, [open]);
}

export default useFullscreenOverlay;
