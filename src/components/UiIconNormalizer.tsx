'use client';

import { useEffect } from 'react';

type IconName =
  | 'alert' | 'arrow-left' | 'arrow-right' | 'ban' | 'calendar' | 'check'
  | 'clipboard' | 'clock' | 'copy' | 'file' | 'folder' | 'graduation'
  | 'lightbulb' | 'logout' | 'package' | 'pencil' | 'plus' | 'qr'
  | 'refresh' | 'ticket' | 'users' | 'x' | 'yen';

const ICON_BY_TOKEN: Record<string, IconName> = {
  '⚠️': 'alert', '⚠': 'alert', '💡': 'lightbulb', '📝': 'file',
  '🕐': 'clock', '⏰': 'clock', '📦': 'package', '➕': 'plus',
  '⚙️': 'pencil', '⚙': 'pencil', '✏️': 'pencil', '✏': 'pencil',
  '🎟️': 'ticket', '🎟': 'ticket', '🎫': 'ticket', '👥': 'users',
  '📄': 'copy', '📁': 'folder', '✅': 'check', '✕': 'x',
  '←': 'arrow-left', '→': 'arrow-right', '➔': 'arrow-right',
  '📅': 'calendar', '🔄': 'refresh', '💴': 'yen', '◼️': 'qr',
  '◼': 'qr', '🎓': 'graduation', '🚫': 'ban', '📋': 'clipboard',
  '🚪': 'logout', '🎉': 'check',
};

const PATHS: Record<IconName, string> = {
  alert: '<path d="m21 19-8-14a2 2 0 0 0-3.5 0l-8 14a2 2 0 0 0 1.8 3h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  'arrow-left': '<path d="m15 18-6-6 6-6"/><path d="M9 12h12"/>',
  'arrow-right': '<path d="m9 18 6-6-6-6"/><path d="M3 12h12"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.5 5.5 13 13"/>',
  calendar: '<path d="M8 2v4M16 2v4M3 10h18"/><rect x="3" y="4" width="18" height="17" rx="2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4.5V3h6v1.5M9 10h6M9 14h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 12h6M9 16h6"/>',
  folder: '<path d="M3 6h7l2 2h9v11H3z"/>',
  graduation: '<path d="m2 10 10-5 10 5-10 5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/>',
  lightbulb: '<path d="M9 18h6M10 22h4"/><path d="M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3Z"/>',
  logout: '<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M18 12H9"/>',
  package: '<path d="m4 7 8-4 8 4-8 4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
  pencil: '<path d="m4 20 4-1 11-11-3-3L5 16Z"/><path d="m14 6 3 3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  qr: '<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><path d="M15 15h2v2h-2zM19 15h2v6h-2M15 19h2v2h-2"/>',
  refresh: '<path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18 9a7 7 0 0 0-12-2l-2 4M6 15a7 7 0 0 0 12 2l2-4"/>',
  ticket: '<path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Z"/><path d="M13 7v12"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a5 5 0 0 1 10 0v2"/><path d="M16 4a3 3 0 0 1 0 6M17 14a5 5 0 0 1 4 4v2"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  yen: '<circle cx="12" cy="12" r="9"/><path d="m9 7 3 4 3-4M9 12h6M9 15h6M12 11v6"/>',
};

const TARGET = '.admin-mode,.header,.error-banner,.badge,button,a,h1,h2,h3,strong';
const SKIP = '.prose,[data-ui-icon-replaced],[contenteditable="true"],textarea,input,select,option,script,style';
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = Object.keys(ICON_BY_TOKEN).sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');

function makeIcon(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.dataset.uiIconReplaced = 'true';
  span.setAttribute('aria-hidden', 'true');
  span.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;flex-shrink:0;vertical-align:-.15em;pointer-events:none';
  span.innerHTML = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return span;
}

function replaceTextNode(node: Text) {
  const value = node.nodeValue;
  const parent = node.parentElement;
  if (!value || !parent || !parent.closest(TARGET) || parent.closest(SKIP)) return;
  if (!new RegExp(pattern).test(value)) return;

  const fragment = document.createDocumentFragment();
  const regex = new RegExp(pattern, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) fragment.append(document.createTextNode(value.slice(lastIndex, match.index)));
    fragment.append(makeIcon(ICON_BY_TOKEN[match[0]]));
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < value.length) fragment.append(document.createTextNode(value.slice(lastIndex)));
  node.replaceWith(fragment);
}

function normalize(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return replaceTextNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach(replaceTextNode);
}

export default function UiIconNormalizer() {
  useEffect(() => {
    normalize(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') normalize(mutation.target);
        mutation.addedNodes.forEach(normalize);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
