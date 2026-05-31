'use client';

import { useMemo } from 'react';
import { Grid2x2, Users2 } from 'lucide-react';

import type { PulsePatternBottleneckApi } from '@/domain/pulse-patterns';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * BottleneckHeatmapWidget (Pulse Wave 6 §6.4) — «Узкие места между командами».
 *
 * Тепловая карта `departments × departments`. Интенсивность — opacity на
 * базе `var(--chip-danger-bg)`. Цифры в ячейках — суммарная severity
 * трений (low=1, medium=2, high=3).
 */

type Props = {
  data: PulsePatternBottleneckApi | null;
  loading: boolean;
  error: string | null;
};

export function BottleneckHeatmapWidget({ data, loading, error }: Props) {
  const maxValue = useMemo(() => {
    if (!data) return 0;
    let max = 0;
    for (const row of data.heatmap) {
      for (const v of row) {
        if (v > max) max = v;
      }
    }
    return max;
  }, [data]);

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Grid2x2 size={16} className="text-accent" />
          Узкие места между командами
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading && <Skeleton className="h-48 w-full" />}
        {!loading && error && (
          <p className="text-sm text-chip-danger-fg">{error}</p>
        )}
        {!loading && !error && data && data.departments.length < 2 && (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-bg-overlay/40 p-6 text-center">
            <Users2 size={28} className="text-fg-tertiary" />
            <p className="text-sm text-fg-secondary">
              Команд недостаточно для построения тепловой карты — нужно
              минимум 2 отдела.
            </p>
          </div>
        )}
        {!loading && !error && data && data.departments.length >= 2 && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="px-2 py-1.5 text-left font-normal text-fg-tertiary">
                      Команда
                    </th>
                    {data.departments.map((d) => (
                      <th
                        key={d.id}
                        className="px-2 py-1.5 text-center font-normal text-fg-tertiary"
                        title={d.name}
                      >
                        <span className="block max-w-[6rem] truncate">
                          {d.name}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((from, i) => (
                    <tr key={from.id}>
                      <td className="max-w-[8rem] truncate px-2 py-1.5 text-fg-secondary">
                        {from.name}
                      </td>
                      {data.departments.map((to, j) => {
                        const v = data.heatmap[i]?.[j] ?? 0;
                        return (
                          <td
                            key={to.id}
                            className="px-1 py-1 text-center"
                            title={`${from.name} ↔ ${to.name}: ${v}`}
                          >
                            <HeatCell value={v} max={maxValue} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.topPairs.length > 0 && (
              <div>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
                  Самые горячие пары
                </h4>
                <ul className="space-y-1">
                  {data.topPairs.map((p) => (
                    <li
                      key={`${p.fromName}->${p.toName}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-bg-overlay/40"
                    >
                      <span className="truncate text-fg-primary">
                        {p.fromName} <span className="text-fg-tertiary">↔</span>{' '}
                        {p.toName}
                      </span>
                      <span className="inline-flex shrink-0 items-center rounded-full bg-chip-danger-bg px-2 py-0.5 text-xs font-medium text-chip-danger-fg">
                        {p.severity}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.topPairs.length === 0 && (
              <p className="text-sm text-fg-tertiary">
                Трений между командами за период не зафиксировано.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HeatCell({ value, max }: { value: number; max: number }) {
  const ratio = max > 0 ? value / max : 0;
  // 0.1 — минимальная заметность; 1.0 — максимум.
  const opacity = value === 0 ? 0 : Math.max(0.12, Math.min(1, ratio));
  return (
    <div
      className={cn(
        'mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-medium tabular-nums transition-opacity',
        value === 0
          ? 'bg-bg-overlay/40 text-fg-tertiary'
          : 'text-chip-danger-fg',
      )}
      style={
        value > 0
          ? {
              backgroundColor: 'var(--chip-danger-bg)',
              opacity: 0.6 + opacity * 0.4,
            }
          : undefined
      }
    >
      {value > 0 ? value : ''}
    </div>
  );
}
