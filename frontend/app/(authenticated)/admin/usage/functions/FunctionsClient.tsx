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
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const PERIODS: AdminPeriod[] = ['day', 'week', 'month'];

export function FunctionsClient() {
  const [period, setPeriod] = useState<AdminPeriod>('week');

  const q = useAdminQuery(
    `admin-functions:${period}`,
    async () => {
      const res = await adminUsageApi.getFunctions({ period });
      return adminFunctionsUsageFromApi(res);
    },
    [period],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Функции LLM</h1>
          <p className="text-sm text-fg-tertiary">
            Все taskType: текущая модель, fallback, экономика, fail rate.
          </p>
        </div>
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
      </div>

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
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
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
                {q.data.items
                  .slice()
                  .sort((a, b) => b.totalCostUsd - a.totalCostUsd)
                  .map((f) => (
                    <tr
                      key={f.taskType}
                      className="border-t border-border-subtle hover:bg-bg-overlay"
                    >
                      <td className="px-3 py-2">
                        <Link
                          href={`/admin/usage/functions/${encodeURIComponent(f.taskType)}`}
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
                          <span className="font-mono text-xs">{f.currentProvider}</span>
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
                            href={`/admin/usage/functions/${encodeURIComponent(f.taskType)}`}
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
        )
      ) : null}
    </div>
  );
}
