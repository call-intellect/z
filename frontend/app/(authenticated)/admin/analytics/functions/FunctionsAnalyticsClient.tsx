'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowRight, FlaskConical } from 'lucide-react';

import { adminUsageApi } from '@/api/admin-usage.api';
import {
  ADMIN_PERIOD_LABELS,
  adminFunctionsUsageFromApi,
  formatDurationMs,
  formatUsd,
  type AdminPeriod,
} from '@/domain/admin-usage';
import { taskTypeLabel } from '@/domain/admin-experiment';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminCsvDownloadButton } from '@/ui/components/admin/AdminCsvDownloadButton';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { cn } from '@/ui/shadcn/lib/utils';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];

/**
 * Аналитика по функциям (taskType) LLM. Перенесена с `/admin/usage/functions`,
 * обёрнута в `AdminSection`, добавлен CSV-экспорт. Управление цепочкой
 * провайдеров доступно в детальной карточке (drill-down).
 */
export function FunctionsAnalyticsClient() {
  const [period, setPeriod] = useState<AdminPeriod>('week');

  const q = useAdminQuery(
    `admin-analytics-functions:${period}`,
    async () => {
      const res = await adminUsageApi.getFunctions({ period });
      return adminFunctionsUsageFromApi(res);
    },
    [period],
  );

  const sorted = (q.data?.items ?? [])
    .slice()
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  const csvRows: Array<Record<string, unknown>> = sorted.map((f) => ({
    taskType: f.taskType,
    label: taskTypeLabel(f.taskType),
    provider: f.currentProvider ?? '',
    abTest: f.experimentEnabled ? 'да' : 'нет',
    totalCalls: f.totalCalls,
    failRatePct: (f.failRate * 100).toFixed(2),
    avgCostUsd: f.avgCostUsd.toFixed(6),
    avgDurationMs: Math.round(f.avgDurationMs),
    totalCostUsd: f.totalCostUsd.toFixed(4),
  }));

  return (
    <AdminSection
      title="Функции LLM"
      description="Все taskType: текущая модель, fallback, экономика, fail rate. Drill-down — на детальную карточку."
      actions={
        <>
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as AdminPeriod)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {ADMIN_PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AdminCsvDownloadButton
            rows={csvRows}
            columns={[
              { key: 'taskType', label: 'taskType' },
              { key: 'label', label: 'Функция' },
              { key: 'provider', label: 'Текущая модель' },
              { key: 'abTest', label: 'A/B' },
              { key: 'totalCalls', label: 'Вызовов' },
              { key: 'failRatePct', label: 'Fail rate, %' },
              { key: 'avgCostUsd', label: 'Avg cost, USD' },
              { key: 'avgDurationMs', label: 'Avg latency, ms' },
              { key: 'totalCostUsd', label: 'Total, USD' },
            ]}
            filename={`admin-functions-${period}.csv`}
          />
        </>
      }
    >
      <div className="space-y-4">
        {q.isLoading && <AdminLoading rows={8} />}
        {!q.isLoading && q.isForbidden && <AdminForbidden />}
        {!q.isLoading && q.error && (
          <AdminError message={q.error} onRetry={q.refetch} />
        )}
        {!q.isLoading && !q.isForbidden && !q.error && q.data ? (
          q.data.items.length === 0 ? (
            <AdminEmpty
              title="Нет функций"
              description="ALL_LLM_TASK_TYPES не возвращает данных. Если такое случилось — проверьте backend (это баг)."
            />
          ) : (
            <>
              {/* Desktop таблица */}
              <div className="hidden overflow-x-auto rounded-lg border border-border-subtle md:block">
                <table className="w-full text-sm">
                  <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                    <tr>
                      <th className="px-3 py-2 text-left">Функция</th>
                      <th className="px-3 py-2 text-left">Текущая модель</th>
                      <th className="px-3 py-2 text-right">Вызовов</th>
                      <th className="px-3 py-2 text-right">Fail rate</th>
                      <th className="px-3 py-2 text-right">Avg cost</th>
                      <th className="px-3 py-2 text-right">Avg latency</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((f) => (
                      <tr
                        key={f.taskType}
                        className="border-t border-border-subtle hover:bg-bg-overlay"
                      >
                        <td className="px-3 py-2">
                          <Link
                            href={`/admin/analytics/functions/${encodeURIComponent(f.taskType)}`}
                            className="flex flex-col gap-0.5 hover:text-accent"
                          >
                            <span className="font-medium">
                              {taskTypeLabel(f.taskType)}
                            </span>
                            <span className="font-mono text-[10px] text-fg-tertiary">
                              {f.taskType}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {f.currentProvider ? (
                            <span className="font-mono text-xs">
                              {f.currentProvider}
                            </span>
                          ) : (
                            <span className="text-fg-tertiary">не задано</span>
                          )}
                          {f.experimentEnabled && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-0.5 text-[10px] text-accent">
                              <FlaskConical size={10} /> A/B
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {f.totalCalls.toLocaleString('ru-RU')}
                        </td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${
                            f.failRate > 0.05 ? 'text-warning' : ''
                          }`}
                        >
                          {(f.failRate * 100).toFixed(1)}%
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatUsd(f.avgCostUsd)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatDurationMs(f.avgDurationMs)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">
                          {formatUsd(f.totalCostUsd)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              href={`/admin/analytics/functions/${encodeURIComponent(f.taskType)}`}
                            >
                              <ArrowRight size={12} />
                            </Link>
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card-view */}
              <ul className="space-y-2 md:hidden">
                {sorted.map((f) => (
                  <li
                    key={f.taskType}
                    className="rounded-lg border border-border-subtle bg-bg-card p-3"
                  >
                    <Link
                      href={`/admin/analytics/functions/${encodeURIComponent(f.taskType)}`}
                      className="flex items-start justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg-primary">
                          {taskTypeLabel(f.taskType)}
                        </div>
                        <div className="truncate font-mono text-[10px] text-fg-tertiary">
                          {f.taskType}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium tabular-nums text-fg-primary">
                          {formatUsd(f.totalCostUsd)}
                        </div>
                        <div className="text-[11px] tabular-nums text-fg-tertiary">
                          {f.totalCalls.toLocaleString('ru-RU')} вызовов
                        </div>
                      </div>
                    </Link>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                      {f.currentProvider ? (
                        <span className="rounded bg-bg-overlay px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary">
                          {f.currentProvider}
                        </span>
                      ) : (
                        <span className="text-fg-tertiary">модель не задана</span>
                      )}
                      {f.experimentEnabled && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted px-2 py-0.5 text-[10px] text-accent">
                          <FlaskConical size={10} /> A/B
                        </span>
                      )}
                      <span
                        className={cn(
                          'ml-auto tabular-nums',
                          f.failRate > 0.05 ? 'text-warning' : 'text-fg-tertiary',
                        )}
                      >
                        fail {(f.failRate * 100).toFixed(1)}%
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}
      </div>
    </AdminSection>
  );
}
