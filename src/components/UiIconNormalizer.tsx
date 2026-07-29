'use client';

import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCopy,
  Clock3,
  Copy,
  FileText,
  FolderOpen,
  GraduationCap,
  Lightbulb,
  LogOut,
  PackageOpen,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  Ticket,
  Tickets,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICON_MAP = new Map<string, LucideIcon>([
  ['⚠️', AlertTriangle],
  ['⚠', AlertTriangle],
  ['💡', Lightbulb],
  ['📝', FileText],
  ['🕐', Clock3],
  ['⏰', Clock3],
  ['📦', PackageOpen],
  ['➕', Plus],
  ['⚙️', Pencil],
  ['⚙', Pencil],
  ['✏️', Pencil],
  ['✏', Pencil],
  ['🎟️', Ticket],
  ['🎟', Ticket],
  ['🎫', Tickets],
  ['👥', Users],
  ['📄', Copy],
  ['📁', FolderOpen],
  ['✅', CheckCircle2],
  ['✕', X],
  ['←', ArrowLeft],
  ['→', ArrowRight],
  ['➔', ArrowRight],
  ['📅', CalendarDays],
  ['🔄', RefreshCw],
  ['💴', CircleDollarSign],
  ['◼️', QrCode],
  ['◼', QrCode],
  ['🎓', GraduationCap],
  ['🚫', Ban],
  ['📋', ClipboardCopy],
  ['🚪', LogOut],
  ['🎉', CheckCircle2],
]);

const TARGET_SELECTOR = [
  '.admin-mode',
  '.header',
  '.error-banner',
  '.badge',
  'button',
  'a',
  'h1',
  'h2',
  'h3',
  'strong',
].join(',');

const SKIP_SELECTOR = [
  '.prose',
  '[data-ui-icon-replaced]',
  '[contenteditable="true"]',
  'textarea',
  'input',
  'select',
  'option',
  'script',
  'style',
].join(',');

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tokenPattern = Array.from(ICON_MAP.keys())
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

function replaceIconsInTextNode(textNode: Text) {
  const value = textNode.nodeValue;
  const parent = textNode.parentElement;

  if (!value || !parent) return;
  if (!parent.closest(TARGET_SELECTOR)) return;
  if (parent.closest(SKIP_SELECTOR)) return;

  const testRegex = new RegExp(tokenPattern);
  if (!testRegex.test(value)) return;

  const fragment = document.createDocumentFragment();
  const tokenRegex = new RegExp(tokenPattern, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(value)) !== null) {
    const matchIndex = match.index ?? 0;
    const token = match[0];

    if (matchIndex > lastIndex) {
      fragment.append(document.createTextNode(value.slice(lastIndex, matchIndex)));
    }

    const Icon = ICON_MAP.get(token);
    if (Icon) {
      const iconContainer = document.createElement('span');
      iconContainer.setAttribute('data-ui-icon-replaced', 'true');
      iconContainer.setAttribute('aria-hidden', 'true');
      iconContainer.style.display = 'inline-flex';
      iconContainer.style.alignItems = 'center';
      iconContainer.style.justifyContent = 'center';
      iconContainer.style.width = '1em';
      iconContainer.style.height = '1em';
      iconContainer.style.flexShrink = '0';
      iconContainer.style.verticalAlign = '-0.15em';
      iconContainer.style.pointerEvents = 'none';

      fragment.append(iconContainer);
      createRoot(iconContainer).render(
        <Icon size="1em" strokeWidth={2.1} aria-hidden="true" focusable="false" />
      );
    } else {
      fragment.append(document.createTextNode(token));
    }

    lastIndex = matchIndex + token.length;
  }

  if (lastIndex < value.length) {
    fragment.append(document.createTextNode(value.slice(lastIndex)));
  }

  textNode.replaceWith(fragment);
}

function normalizeTree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    replaceIconsInTextNode(root as Text);
    return;
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text);
  }

  textNodes.forEach(replaceIconsInTextNode);
}

export default function UiIconNormalizer() {
  useEffect(() => {
    normalizeTree(document.body);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'characterData') {
          normalizeTree(mutation.target);
          return;
        }

        mutation.addedNodes.forEach(normalizeTree);
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
