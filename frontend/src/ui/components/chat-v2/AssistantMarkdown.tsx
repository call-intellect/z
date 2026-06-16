'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { stripContextMarkers } from '@/domain/chat-v2';

/**
 * Единый рендер ответа ассистента «Мастер Кора» как markdown.
 *
 * Раньше тело ответа выводилось голым текстом в `whitespace-pre-wrap`, из-за
 * чего markdown от модели (**жирный**, списки `1.`/`-`, заголовки) показывался
 * сырыми символами и сливался в «стену». Здесь — `react-markdown` +
 * `rehype-sanitize` (как в `MeetingSummaryRender`), но без `prose`: цвета и
 * размер наследуются от родительского бабла (`text-fg-*`), поэтому ответ
 * корректно читается и в светлой, и в тёмной теме.
 *
 * Служебные маркеры `[BLOCK:id]`, `[CONTRADICTING BLOCK]` и т.п. срезаются
 * `stripContextMarkers` ДО парсинга markdown (цитаты показываются отдельным
 * блоком «Источники»).
 */
const MARKDOWN_COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-fg-primary">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  h1: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h3>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-accent underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 italic text-fg-secondary">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-bg px-1 py-0.5 text-xs">{children}</code>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

export function AssistantMarkdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="break-words leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={MARKDOWN_COMPONENTS}
      >
        {stripContextMarkers(text)}
      </ReactMarkdown>
    </div>
  );
}
