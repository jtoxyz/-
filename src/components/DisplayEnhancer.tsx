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

    if (text === '開催枠') {
      const slotName = element.nextElementSibling;
      const slotDate = slotName?.nextElementSibling;

      if (slotName instanceof HTMLElement) {
        slotName.classList.add('ticket-slot-name-emphasis');
      }
      if (slotDate instanceof HTMLElement) {
        slotDate.classList.add('ticket-slot-date-compact');
      }
    }

    if (text === '予約券 使用可能時間' || text === '当日券 使用可能時間') {
      const box = element.parentElement;
      if (!box) return;

      box.classList.add('ticket-use-window-emphasis');
      element.classList.add('ticket-use-window-title');

      const time = element.nextElementSibling;
      if (time instanceof HTMLElement) {
        time.classList.add('ticket-use-window-time');

        if (!time.dataset.splitApplied) {
          const parts = (time.textContent ?? '').split('〜').map((part) => part.trim());
          if (parts.length === 2) {
            time.replaceChildren();

            const start = document.createElement('span');
            start.className = 'ticket-use-window-date-line';
            start.textContent = parts[0];

            const separator = document.createElement('span');
            separator.className = 'ticket-use-window-separator';
            separator.textContent = '〜';

            const end = document.createElement('span');
            end.className = 'ticket-use-window-date-line';
            end.textContent = parts[1];

            time.append(start, separator, end);
            time.dataset.splitApplied = 'true';
          }
        }
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
