"use client";

import Link from "next/link";
import { CircleHelp, Repeat } from "lucide-react";

import type { PulsePatternRecurringTopicApi } from "@/domain/pulse-patterns";
import {
  MiniBarRow,
  MiniSparkline,
  autoTone,
} from "@/ui/components/dashboard/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";

type Props = {
  data: PulsePatternRecurringTopicApi | null;
  loading: boolean;
  error: string | null;
};

export function RecurringTopicsWidget({ data, loading, error }: Props) {
  const topics = data?.topics ?? [];
  const maxMention = topics.reduce(
    (acc, t) => (t.mentionCount > acc ? t.mentionCount : acc),
    0,
  );
  const sparklineData = topics.map((t) => t.mentionCount);

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
          <>
            {sparklineData.length > 1 && (
              <div className="mb-3 flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-fg-tertiary">
                  Плотность упоминаний
                </span>
                <MiniSparkline
                  data={sparklineData}
                  tone="accent"
                  width={120}
                  height={20}
                  className="flex-1"
                />
              </div>
            )}
            <ul className="space-y-1">
              {data.topics.map((t) => {
                const ratio = maxMention > 0 ? t.mentionCount / maxMention : 0;
                const tone = autoTone(1 - ratio);
                const inner = (
                  <div className="rounded-md p-2 text-sm hover:bg-bg-overlay/40">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-fg-primary">
                          {t.themeName}
                        </p>
                        <p className="mt-0.5 text-xs text-fg-tertiary">
                          {t.meetingCount} встреч · окно {t.windowDays} дн.
                        </p>
                      </div>
                      <div className="w-28 shrink-0 sm:w-36">
                        <MiniBarRow
                          value={t.mentionCount}
                          max={maxMention || 1}
                          tone={tone}
                          suffix="уп."
                        />
                      </div>
                    </div>
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
