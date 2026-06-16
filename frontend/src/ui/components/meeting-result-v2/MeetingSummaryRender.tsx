'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Рендер краткого содержания встречи.
 *
 * Используется в пользовательской карточке встречи (`MeetingResultPageReal`).
 *
 * Источник `markdown` определяется через `pickPrimarySummary` в
 * `@/domain/ai-result`:
 *   - приоритет — `summaryFast` (`MeetingReportFastWorker`, 2026-05-25);
 *   - legacy — `summary` (single-step prompt).
 *
 * Для `fast` ожидается markdown — рендерится через `react-markdown@10` +
 * `rehype-sanitize@6`. Для legacy `summary` это был plain-text, но
 * markdown-рендер совместим (без разметки результат выглядит как обычный текст).
 */
export function MeetingSummaryRender({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'prose prose-sm max-w-none text-fg-primary [&>*]:my-2',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{markdown}</ReactMarkdown>
    </div>
  );
}
