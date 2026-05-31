'use client';

import Link from 'next/link';
import { CircleHelp, Repeat } from 'lucide-react';

import type { PulsePatternRecurringTopicApi } from '@/domain/pulse-patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * RecurringTopicsWidget (Pulse Wave 6 §6.2) — «Что мы обсуждаем по кругу».
 *
 * Топ-N тем без implemented Decision из последних snapshot'ов
 * `RecurringTopic`. Кликом — на страницу темы (если есть themeId).
 */

type Props = {
  data: PulsePatternRecurringTopicApi | null;
  loading: boolean;
  error: string | null;
};

export function RecurringTopicsWidget({ data, loading, error }: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Repeat size={16} className="text-accent" />
          Что мы обсуждаем по кругу
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}
        {!loading && !error && data && data.topics.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-bg-overlay/40 p-6 text-center">
            <CircleHelp size={28} className="text-chip-success-fg" />
            <p className="text-sm text-fg-secondary">
              Повторяющихся тем без решений нет.
            </p>
          </div>
        )}
        {!loading && !error && data && data.topics.length > 0 && (
          <ul className="space-y-1">
            {data.topics.map((t) => {
              const inner = (
                <div className="rounded-md p-2 text-sm hover:bg-bg-overlay/40">
                  <p className="truncate font-medium text-fg-primary">
                    {t.themeName}
                  </p>
                  <p className="mt-0.5 text-xs text-fg-tertiary">
                    {t.mentionCount} упоминаний · {t.meetingCount} встреч · окно
                    {' '}
                    {t.windowDays} дн.
                  </p>
                </div>
              );
              if (t.themeId) {
                return (
                  <li key={t.themeId}>
                    <Link href={`/themes/${encodeURIComponent(t.themeId)}`}>
                      {inner}
                    </Link>
                  </li>
                );
              }
              return <li key={t.themeName}>{inner}</li>;
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
