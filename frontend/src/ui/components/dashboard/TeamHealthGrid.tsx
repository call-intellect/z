'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Minus, Users } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { dashboardApi } from '@/api/dashboard.api';
import type {
  HealthToneDomain,
  TeamHealthAttrDomain,
  TeamHealthDomain,
  TeamHealthRowDomain,
} from '@/domain/team-health';
import { teamHealthFromApi } from '@/domain/team-health';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * TeamHealthGrid — таблица здоровья команд (Pulse Wave 1 §1.6).
 *
 * Источник: `GET /api/v1/dashboard/team-health`.
 *
 * 4 метрики на отдел:
 *   - Настроение (sentiment, -100..+100)
 *   - Обещания (promises, 0..100 %)
 *   - Конфликты (conflicts, число пар)
 *   - Решения (decisions, плейсхолдер v1 — neutral)
 *
 * Отделы <3 чел. показываются с заглушкой «нужно ≥3».
 * При отсутствии отделов — empty-state со ссылкой в /admin/departments.
 */
type Props = {
  className?: string;
};

const TONE_CHIP: Record<HealthToneDomain, string> = {
  success: 'bg-chip-success-bg text-chip-success-fg',
  warning: 'bg-chip-warning-bg text-chip-warning-fg',
  danger: 'bg-chip-danger-bg text-chip-danger-fg',
  neutral: 'bg-bg-overlay text-fg-tertiary',
};

export function TeamHealthGrid({ className }: Props) {
  const [data, setData] = useState<TeamHealthDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await dashboardApi.getTeamHealth();
        if (alive) setData(teamHealthFromApi(res));
      } catch (e) {
        if (alive) {
          setError(
            e instanceof ApiError ? e.message : 'Не удалось загрузить здоровье команд',
          );
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card className={cn('lg:col-span-2', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users size={16} className="text-accent" />
          Здоровье команд
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <SkeletonRows />}
        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}
        {!loading && !error && data && data.teams.length === 0 && <EmptyState />}
        {!loading && !error && data && data.teams.length > 0 && (
          <Grid data={data} />
        )}
      </CardContent>
    </Card>
  );
}

function Grid({ data }: { data: TeamHealthDomain }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-fg-tertiary">
            <th className="px-2 py-2 text-left font-medium">Команда</th>
            <th className="px-2 py-2 text-center font-medium">Настроение</th>
            <th className="px-2 py-2 text-center font-medium">Обещания</th>
            <th className="px-2 py-2 text-center font-medium">Конфликты</th>
            <th className="px-2 py-2 text-center font-medium">Решения</th>
          </tr>
        </thead>
        <tbody>
          {data.teams.map((row) => (
            <Row key={row.departmentId} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: TeamHealthRowDomain }) {
  if (row.belowCohort) {
    return (
      <tr className="border-t border-border-subtle/60 text-fg-tertiary">
        <td className="px-2 py-3">
          <div>{row.departmentName}</div>
          <div className="text-[11px]">{row.size} чел. · нужно ≥3</div>
        </td>
        <td colSpan={4} className="px-2 py-3 text-center text-xs">
          Слишком маленький отдел — здоровье не считается
        </td>
      </tr>
    );
  }
  return (
    <tr
      className="border-t border-border-subtle/60 hover:bg-bg-overlay/40"
      title="Подробности появятся в следующих обновлениях"
    >
      <td className="px-2 py-3">
        <div className="font-medium text-fg-primary">{row.departmentName}</div>
        <div className="text-[11px] text-fg-tertiary">{row.size} чел.</div>
      </td>
      <td className="px-2 py-3 text-center">
        <AttrChip attr={row.sentiment} formatter={formatSigned} />
      </td>
      <td className="px-2 py-3 text-center">
        <AttrChip attr={row.promises} formatter={(v) => `${v}%`} />
      </td>
      <td className="px-2 py-3 text-center">
        <AttrChip attr={row.conflicts} formatter={(v) => String(v)} />
      </td>
      <td className="px-2 py-3 text-center">
        <AttrChip attr={row.decisions} formatter={(v) => String(v)} />
      </td>
    </tr>
  );
}

function AttrChip({
  attr,
  formatter,
}: {
  attr: TeamHealthAttrDomain;
  formatter: (v: number) => string;
}) {
  const TrendIcon =
    attr.trend === 'up'
      ? ArrowUpRight
      : attr.trend === 'down'
        ? ArrowDownRight
        : attr.trend === 'flat'
          ? Minus
          : null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
        TONE_CHIP[attr.tone],
      )}
    >
      {formatter(attr.value)}
      {TrendIcon && <TrendIcon size={12} />}
    </span>
  );
}

function formatSigned(v: number): string {
  if (v > 0) return `+${v}`;
  return String(v);
}

function EmptyState() {
  return (
    <div className="rounded-xl bg-bg-overlay/40 p-6 text-center">
      <p className="text-sm text-fg-secondary">
        Создайте отделы — здоровье команд будет считаться автоматически.
      </p>
      <Link
        href="/admin/departments"
        className="mt-3 inline-block text-sm text-accent underline-offset-2 hover:underline"
      >
        Перейти в настройки отделов →
      </Link>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  );
}
