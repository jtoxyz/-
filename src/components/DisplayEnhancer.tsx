'use client';

import { useEffect } from 'react';

const DATE_TIME_PATTERN = /(\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+\(([^)]+)\)/g;
const FULL_DATE_TIME_PATTERN = /(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+\(([^)]+)\)/g;

function getUnpaidReservationEmails(): string[] {
  const emails = new Set<string>();

  document
    .querySelectorAll<HTMLTableRowElement>('.reservations-table-desktop tbody tr')
    .forEach((row) => {
      const cells = row.querySelectorAll<HTMLTableCellElement>('td');
      if (cells.length < 7) return;

      const ticketType = cells[1].textContent?.trim() ?? '';
      const email = cells[5].textContent?.trim() ?? '';
      const status = cells[6].textContent?.trim() ?? '';

      if (
        ticketType.includes('予約券') &&
        status.includes('有効') &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      ) {
        emails.add(email);
      }
    });

  return Array.from(emails);
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();

  if (!copied) throw new Error('コピーに失敗しました');
}

function addUnpaidEmailCopyButton() {
  if (!/^\/admin\/events\/[^/]+\/reservations\/?$/.test(window.location.pathname)) return;
  if (document.getElementById('copy-unpaid-reservation-emails')) return;

  const excelButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.includes('Excel出力')
  );
  const buttonArea = excelButton?.parentElement;
  if (!buttonArea) return;

  const button = document.createElement('button');
  button.id = 'copy-unpaid-reservation-emails';
  button.type = 'button';
  button.className = 'btn btn-secondary';
  button.style.padding = '10px 16px';
  button.style.minWidth = '210px';

  const refreshLabel = () => {
    const count = getUnpaidReservationEmails().length;
    button.textContent = `📧 未払い者メール（BCC）コピー：${count}人`;
    button.disabled = count === 0;
  };

  button.addEventListener('click', async () => {
    const emails = getUnpaidReservationEmails();
    if (emails.length === 0) {
      window.alert('未払いの予約者は見つかりませんでした。');
      refreshLabel();
      return;
    }

    try {
      await copyText(emails.join(', '));
      window.alert(`${emails.length}人分のメールアドレスをBCC用にコピーしました。\nGmailのBCC欄へ貼り付けてください。`);
    } catch (error) {
      console.error('Failed to copy unpaid reservation emails:', error);
      window.alert('メールアドレスのコピーに失敗しました。ブラウザの権限をご確認ください。');
    }
  });

  buttonArea.insertBefore(button, excelButton ?? null);
  refreshLabel();
}

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

  addUnpaidEmailCopyButton();
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
