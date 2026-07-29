'use client';

import type { CSSProperties } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { parseShortcodes } from '@/lib/parseShortcodes';

export default function RichText({
  content,
  style,
}: {
  content: string;
  style?: CSSProperties;
}) {
  const html = DOMPurify.sanitize(
    marked.parse(parseShortcodes(content), { breaks: true }) as string,
    { ADD_ATTR: ['style'] },
  );

  return <div className="prose prose-sm max-w-none" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
