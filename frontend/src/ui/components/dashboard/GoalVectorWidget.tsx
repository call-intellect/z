'use client';

import { Target } from 'lucide-react';

import type { PulsePatternGoalVectorApi } from '@/domain/pulse-patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * GoalVectorWidget (Pulse Wave 6 §6.6) — «Вектор компании».
 *
 * Топ-N активных целей с агрегатом `PersonGoalContribution.netScore` за
 * окно. Прогресс-полоска отражает знак (positive → success, negative →
 * danger). Под целью — топ contributors.
 */

type Props = {
  data: PulsePatternGoalVectorApi | null;
  loading: boolean;
  error: string | null;
};

export function GoalVectorWidget({ data, loading, error }: Props) {
  const maxAbs = (() => {
    if (!data) return 0;
    let max = 0;
    for (const g of data.goals) {
      const a = Math.abs(g.netScore);
      if (a > max) max = a;
    }
    return max;
  })();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target size={16} className="text-accent" />
          Вектор компании
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-3/4" />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}
        {!loading && !error && data && data.goals.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-bg-overlay/40 p-6 text-center">
            <Target size={28} className="text-fg-tertiary" />
            <p className="text-sm text-fg-secondary">
              Цели ещё не созданы или не собран первый вектор. Появится после
              первого прогона goal-vector-tracker.
            </p>
          </div>
        )}
        {!loading && !error && data && data.goals.length > 0 && (
          <ul className="space-y-4">
            {data.goals.map((g) => {
              const positive = g.netScore >= 0;
              const ratio =
                maxAbs > 0
                  ? Math.min(1, Math.abs(g.netScore) / maxAbs)
                  : 0;
              return (
                <li key={g.goalId} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-fg-primary">
                      {g.goalTitle}
                    </p>
                    <span
                      className={cn(
                        'text-sm font-semibold tabular-nums',
                        positive
                          ? 'text-chip-success-fg'
                          : 'text-chip-danger-fg',
                      )}
                    >
                      {positive ? '+' : ''}
                      {g.netScore.toFixed(1)}
                    </span>
                  </div>
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-bg-overlay/60">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        positive
                          ? 'bg-chip-success-fg/70'
                          : 'bg-chip-danger-fg/70',
                      )}
                      style={{
                        width: `${Math.max(4, Math.round(ratio * 100))}%`,
                      }}
                    />
                  </div>
                  {g.topContributors.length > 0 && (
                    <p className="text-xs text-fg-tertiary">
                      {g.topContributors
                        .map(
                          (c) =>
                            `${c.personName} (${
                              c.netScore >= 0 ? '+' : ''
                            }${c.netScore.toFixed(1)})`,
                        )
                        .join(' · ')}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
