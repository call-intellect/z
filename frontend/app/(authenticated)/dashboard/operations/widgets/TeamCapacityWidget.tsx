'use client';

import { Users } from 'lucide-react';
import useSWR from 'swr';

import { operationsDashboardApi } from '@/api/operations-dashboard.api';
import {
  fromTeamCapacityApi,
  type TeamCapacityClassification,
} from '@/domain/operations-dashboard';
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  StatusPill,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-3 Ф2 — виджет «Загрузка команд» на COO-дашборде.
 *
 * Self-fetch через SWR на `operationsDashboardApi.getTeamCapacity()`.
 * Источник `loadPercent` в проде заполнен разрежённо → `empty=true` —
 * ожидаемое и частое состояние (показываем понятную заглушку).
 *
 * Иначе — строки по отделам: название, число людей, бар средней загрузки
 * и плашка статуса (перегруз→риск, недогруз→внимание, в норме→ок).
 */

/** Классификация → тон плашки нового языка дашбордов. */
const CLASSIFICATION_TONE: Record<
  TeamCapacityClassification,
  'ok' | 'warning' | 'risk'
> = {
  overload: 'risk',
  underload: 'warning',
  ok: 'ok',
};

export function TeamCapacityWidget() {
  const swr = useSWR(
    ['operations-team-capacity'],
    () => operationsDashboardApi.getTeamCapacity(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const data = swr.data ? fromTeamCapacityApi(swr.data) : null;

  return (
    <GlassCard>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<Users size={16} />} grad={GRAD.blue}>
          Загрузка команд
        </CardTitle>
        {data && !data.empty ? (
          <span className="text-xs" style={{ color: CHART.faint }}>
            перегружено {data.overloadedCount} · недогружено{' '}
            {data.underloadedCount}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        {swr.isLoading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка…
          </p>
        ) : swr.error ? (
          <p className="text-sm" style={{ color: CHART.red }}>
            {swr.error instanceof Error
              ? swr.error.message
              : 'Не удалось загрузить данные'}
          </p>
        ) : !data || data.empty || data.items.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка появится, когда отделам проставят нагрузку.
          </p>
        ) : (
          <ul className="space-y-3">
            {data.items.map((d) => {
              const widthPct = Math.max(0, Math.min(100, d.avgLoadPercent));
              return (
                <li key={d.departmentId}>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">{d.departmentName}</span>
                      <span className="text-xs" style={{ color: CHART.faint }}>
                        {d.personCount} чел.
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className="tabular-nums text-xs"
                        style={{ color: CHART.dim }}
                      >
                        {Math.round(d.avgLoadPercent)}%
                      </span>
                      <StatusPill status={CLASSIFICATION_TONE[d.classification]} />
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full overflow-hidden rounded-full"
                    style={{ background: 'var(--surface-inset-strong)' }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${widthPct}%`, background: GRAD.teal }}
                      aria-hidden
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
