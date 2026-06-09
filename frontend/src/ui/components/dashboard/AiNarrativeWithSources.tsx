'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';

import type {
  CitationDomain,
  NarrativeSummaryDomain,
} from '@/domain/director-dashboard';
import { cn } from '@/ui/shadcn/lib/utils';

type Props = {
  data: NarrativeSummaryDomain;
  periodLabel: string;
  className?: string;
};

/**
 * AI-сводка дашборда с прозрачными цитатами. Pulse Wave 1 §1.4.
 *
 * Inline-номера [1] [2] — суперскрипт + клик ведёт на источник.
 * Под текстом — список «Источники: [1] ... [2] ...» с deep-link.
 */
export function AiNarrativeWithSources({ data, periodLabel, className }: Props) {
  // Разбиваем text по маркерам [1], [2], ... и оборачиваем номера в clickable spans.
  const parts = renderInlineCitations(data.text, data.citations);

  return (
    <div
      className={cn(
        'mb-6 rounded-xl border border-accent/25 bg-accent/5 p-4 shadow-card-soft',
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-accent">
        <Sparkles size={14} />
        Сводка Коры за {periodLabel}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
        {parts}
      </p>
      {data.citations.length > 0 && (
        <div className="mt-3 border-t border-accent/15 pt-2 text-[11px] leading-relaxed text-fg-tertiary">
          <span className="font-medium text-fg-secondary">Источники: </span>
          {data.citations.map((c, idx) => (
            <span key={`${c.type}:${c.id}`}>
              {idx > 0 && ' · '}
              {c.url ? (
                <Link
                  href={c.url}
                  className="underline decoration-fg-tertiary/40 underline-offset-2 hover:text-accent hover:decoration-accent"
                >
                  [{c.number}] {truncate(c.label, 50)}
                </Link>
              ) : (
                <span>
                  [{c.number}] {truncate(c.label, 50)}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-fg-tertiary">
        Сводка Коры, может содержать ошибки.
      </p>
    </div>
  );
}

function renderInlineCitations(
  text: string,
  citations: CitationDomain[],
): ReactNode[] {
  if (citations.length === 0) return [text];
  const numToCit = new Map<number, CitationDomain>();
  for (const c of citations) numToCit.set(c.number, c);

  const result: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      result.push(text.slice(lastIdx, match.index));
    }
    const num = Number(match[1]);
    const c = numToCit.get(num);
    if (c && c.url) {
      result.push(
        <Link
          key={`cit-${key++}`}
          href={c.url}
          className="ml-0.5 rounded-sm bg-accent/10 px-1 align-super text-[10px] font-medium text-accent hover:bg-accent/20"
          title={c.label}
        >
          [{num}]
        </Link>,
      );
    } else if (c) {
      result.push(
        <span
          key={`cit-${key++}`}
          className="ml-0.5 rounded-sm bg-accent/10 px-1 align-super text-[10px] font-medium text-accent"
          title={c.label}
        >
          [{num}]
        </span>,
      );
    } else {
      result.push(match[0]);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) result.push(text.slice(lastIdx));
  return result;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
