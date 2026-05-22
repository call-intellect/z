'use client';

import { AlertTriangle, ArrowRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import useSWR from 'swr';

import { insightsApi } from '@/api/insights.api';
import {
  INSIGHT_DYNAMIC_LABEL,
  INSIGHT_KIND_LABEL,
  INSIGHT_SEVERITY_LABEL,
} from '@/domain/insight';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Виджет «Топ-5 повторяющихся проблем» (SBA β-4).
 *
 * Источник правды: `GET /api/v1/insights/top?limit=5`.
 * Сортировка на бэке: spike first → severity desc → frequencyScore desc.
 * Клик по строке → `/insights/:id` (master-detail).
 */
export function InsightsTopWidget() {
  const swr = useSWR(
    ['insights-top'],
    async () => insightsApi.top(5),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle size={16} className="text-accent" />
          Топ-5 повторяющихся проблем
        </CardTitle>
      </CardHeader>
      <CardContent>
        {swr.isLoading ? (
          <Skeleton className="h-32" />
        ) : !swr.data || swr.data.items.length === 0 ? (
          <p className="py-6 text-center text-xs text-fg-tertiary">
            Повторяющихся сигналов пока не выявлено.
          </p>
        ) : (
          <ul className="space-y-2">
            {swr.data.items.map((it) => (
              <li key={it.id}>
                <Link
                  href={`/insights/${it.id}`}
                  className="flex items-start justify-between gap-3 rounded-md border border-transparent p-2 transition hover:border-border-subtle hover:bg-fg-tertiary/5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-fg-primary">
                      {it.statement}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-fg-tertiary">
                      <span>{INSIGHT_KIND_LABEL[it.kind]}</span>
                      <span>·</span>
                      <span>{INSIGHT_SEVERITY_LABEL[it.severity]}</span>
                      <span>·</span>
                      <span
                        className={
                          it.dynamicLabel === 'spike' ||
                          it.dynamicLabel === 'growing'
                            ? 'text-red-500'
                            : ''
                        }
                      >
                        <TrendingUp size={10} className="inline" />{' '}
                        {INSIGHT_DYNAMIC_LABEL[it.dynamicLabel]}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end text-[10px] text-fg-tertiary">
                    <span className="tabular-nums">
                      {Math.round(it.frequencyScore * 100)}%
                    </span>
                    <span>{it.sourceBlocksCount} упом.</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex justify-end">
          <Link
            href="/insights"
            className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
          >
            Открыть радар <ArrowRight size={12} />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
