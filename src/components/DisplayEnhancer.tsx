'use client';

import { useEffect } from 'react';

const DATE_TIME_PATTERN = /(\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+\(([^)]+)\)/g;
const FULL_DATE_TIME_PATTERN = /(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+\(([^)]+)\)/g;

function enhanceDisplay(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script, style, textarea, input')) continue;

    const original = node.nodeValue ?? '';
    const updated = original
      .replace(FULL_DATE_TIME_PATTERN, '$1 ($3) $2')
      .replace(DATE_TIME_PATTERN, '$1 ($3) $2');

    if (updated !== original) node.nodeValue = updated;
  }

  document.querySelectorAll<HTMLElement>('span, div').forEach((element) => {
    const text = element.textContent?.trim();
    if (text === '予約券 使用可能時間' || text === '当日券 使用可能時間') {
      const box = element.parentElement;
      if (!box) return;

      box.classList.add('ticket-use-window-emphasis');
      element.classList.add('ticket-use-window-title');

      const time = element.nextElementSibling;
      if (time instanceof HTMLElement) {
        time.classList.add('ticket-use-window-time');
      }
    }
  });
}

export default function DisplayEnhancer() {
  useEffect(() => {
    let scheduled = false;

    const run = () => {
      scheduled = false;
      enhanceDisplay(document.body);
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(run);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, []);

  return null;
}
