'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, Target } from 'lucide-react';

import {
  alignmentTextColor,
  formatAlignment,
  formatDelta,
} from '@/domain/goal';
import type { DirectorDashboardStrategicAlignmentDomain } from '@/domain/director-dashboard';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Виджет «Согласованность стратегии» (Phase 9 frontend, дашборд директора).
 *
 * Отображает взвешенный средний alignment по активным целям Org + список
 * целей с резким падением (`alertGoals`).
 *
 * Источник: `DirectorDashboardDto.strategicAlignment` (опц. поле, заполняется
 * только когда у Org заведены цели — Phase 9 backend).
 */
export function StrategicAlignmentWidget({
  data,
  loading,
}: {
  data: DirectorDashboardStrategicAlignmentDomain | null | undefined;
  loading: boolean;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target size={16} className="text-accent" />
          Согласованность стратегии
        </CardTitle>
        {data && data.goalsCount > 0 && (
          <Badge variant="secondary">{data.goalsCount} целей</Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-32" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : !data || data.goalsCount === 0 ? (
          <EmptyNoGoals />
        ) : data.average === null ? (
          <EmptyNotComputed />
        ) : (
          <Body data={data} />
        )}
      </CardContent>
    </Card>
  );
}

function EmptyNoGoals() {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-fg-tertiary">
        Цели компании не заданы. Создайте первую цель — это включит еженедельный
        мониторинг движения к стратегии.
      </p>
      <Link
        href="/goals"
        className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
      >
        Создать <ArrowRight size={14} />
      </Link>
    </div>
  );
}

function EmptyNotComputed() {
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="text-sm text-fg-tertiary">
        Согласованность ещё не рассчитана. Дождитесь cron&apos;а 04:00 или
        нажмите «Пересчитать» в карточке конкретной цели.
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

function Body({ data }: { data: DirectorDashboardStrategicAlignmentDomain }) {
  const score = data.average === null ? null : Math.round(data.average);
  const hasAlerts = data.alertGoals.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <Link
          href="/goals"
          className={cn(
            'text-5xl font-semibold tabular-nums leading-none transition-opacity hover:opacity-80',
            alignmentTextColor(score),
          )}
          title="Открыть страницу целей"
        >
          {formatAlignment(score)}
        </Link>
        <span className="text-xs text-fg-tertiary">
          / 100 — взвешенное среднее по {data.goalsCount}{' '}
          {pluralizeRu(data.goalsCount, ['активной цели', 'активным целям', 'активным целям'])}
        </span>
      </div>

      {hasAlerts ? (
        <div className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger/5 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-danger">
            <AlertTriangle size={12} />
            Резкое падение по {data.alertGoals.length}{' '}
            {pluralizeRu(data.alertGoals.length, ['цели', 'целям', 'целям'])}
          </div>
          <ul className="flex flex-col gap-1">
            {data.alertGoals.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/goals/${encodeURIComponent(g.id)}`}
                  className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm text-fg-primary transition-colors hover:bg-bg-overlay"
                >
                  <span className="truncate">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-2 text-xs">
                    <span
                      className={cn(
                        'tabular-nums font-semibold',
                        alignmentTextColor(g.score),
                      )}
                    >
                      {g.score}
                    </span>
                    <span className="text-danger tabular-nums">
                      {formatDelta(g.delta) ?? ''}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-fg-tertiary">
          Целей с резким падением нет.{' '}
          <Link href="/goals" className="text-accent hover:underline">
            Открыть цели
          </Link>
        </p>
      )}
    </div>
  );
}

function pluralizeRu(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}
