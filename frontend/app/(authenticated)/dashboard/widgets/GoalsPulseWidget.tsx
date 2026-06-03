'use client';

import Link from 'next/link';
import { Activity, ArrowRight } from 'lucide-react';

import type { GoalsPulseDomain } from '@/domain/director-dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Виджет «Пульс целей» (Goals OKR v2, Фаза 4 — frontend, дашборд директора).
 *
 * Показывает 5 счётчиков целей по оси движения: достигнуто / в движении /
 * под риском / застряло / выпало. Цвета — только парные токены chip-* (bg + fg),
 * никаких hex/text-white (см. правило «парные цветовые токены»).
 *
 * Источник: `DirectorDashboardDto.goalsPulse` (опц. поле — заполняется только
 * когда у Org есть active-цели, Фаза 4A backend). Если поля нет или total===0 —
 * виджет показывает empty-state со ссылкой на `/goals`.
 */
type PulseCell = {
  key: keyof GoalsPulseDomain;
  emoji: string;
  label: string;
  bg: string;
  fg: string;
};

const PULSE_CELLS: readonly PulseCell[] = [
  {
    key: 'achievedCount',
    emoji: '✅',
    label: 'Достигнуто',
    bg: 'bg-chip-info-bg',
    fg: 'text-chip-info-fg',
  },
  {
    key: 'onTrackCount',
    emoji: '🟢',
    label: 'В движении',
    bg: 'bg-chip-success-bg',
    fg: 'text-chip-success-fg',
  },
  {
    key: 'atRiskCount',
    emoji: '🟡',
    label: 'Под риском',
    bg: 'bg-chip-warning-bg',
    fg: 'text-chip-warning-fg',
  },
  {
    key: 'stalledCount',
    emoji: '🔴',
    label: 'Застряло',
    bg: 'bg-chip-danger-bg',
    fg: 'text-chip-danger-fg',
  },
  {
    key: 'droppedCount',
    emoji: '⚪',
    label: 'Выпало',
    bg: 'bg-chip-sand-bg',
    fg: 'text-chip-sand-fg',
  },
];

export function GoalsPulseWidget({
  data,
  loading,
}: {
  data: GoalsPulseDomain | null | undefined;
  loading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity size={16} className="text-accent" />
          Пульс целей
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PULSE_CELLS.map((c) => (
              <Skeleton key={c.key} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : !data || data.total === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PULSE_CELLS.map((cell) => (
              <div
                key={cell.key}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 rounded-lg px-2 py-3',
                  cell.bg,
                  cell.fg,
                )}
              >
                <span className="text-lg tabular-nums font-semibold leading-none">
                  {data[cell.key]}
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium">
                  <span aria-hidden>{cell.emoji}</span>
                  {cell.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-fg-tertiary">
        Пока нет активных целей. Создайте первую цель — и пульс покажет, где
        компания движется, а где застряла.
      </p>
      <Link
        href="/goals"
        className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
      >
        К целям <ArrowRight size={14} />
      </Link>
    </div>
  );
}
