'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';

import { adminApi } from '@/api/admin.api';
import { ApiError } from '@/api/api-error';
import { Button } from '@/ui/components/shared/Button';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { ErrorState } from '@/ui/components/shared/ErrorState';
import { Skeleton } from '@/ui/components/shared/Skeleton';
import { t } from '@/lib/i18n';

import { DateRangePicker } from './DateRangePicker';

type GroupBy = 'day' | 'model' | 'meeting_type';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function toIsoStart(date: string): string {
  // YYYY-MM-DD → YYYY-MM-DDT00:00:00Z (UTC)
  return new Date(`${date}T00:00:00Z`).toISOString();
}

function toIsoEnd(date: string): string {
  // следующий день, чтобы lt-сравнение было правильным.
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function AiUsageDashboard() {
  const [from, setFrom] = useState<string>(defaultFrom());
  const [to, setTo] = useState<string>(defaultTo());
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [appliedKey, setAppliedKey] = useState<{
    from: string;
    to: string;
    groupBy: GroupBy;
  }>({ from, to, groupBy });

  const swrKey = useMemo(
    () => ['admin:ai-usage', appliedKey.from, appliedKey.to, appliedKey.groupBy],
    [appliedKey],
  );

  const { data, error, isLoading, mutate } = useSWR(swrKey, () =>
    adminApi.aiUsage({
      from: toIsoStart(appliedKey.from),
      to: toIsoEnd(appliedKey.to),
      group_by: appliedKey.groupBy,
    }),
  );

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{t('admin.ai_usage.title')}</h1>
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 bg-white p-3">
        <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          <span>{t('admin.ai_usage.group_by')}</span>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="day">{t('admin.ai_usage.group_day')}</option>
            <option value="model">{t('admin.ai_usage.group_model')}</option>
            <option value="meeting_type">{t('admin.ai_usage.group_meeting_type')}</option>
          </select>
        </label>
        <Button
          size="sm"
          onClick={() => setAppliedKey({ from, to, groupBy })}
        >
          {t('admin.ai_usage.apply')}
        </Button>
      </div>

      {error ? (
        <ErrorState
          message={error instanceof ApiError ? error.message : t('errors.unknown')}
          onRetry={() => mutate()}
        />
      ) : isLoading ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState title={t('admin.ai_usage.empty')} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-600">
              <tr>
                <th className="px-3 py-2">{t('admin.ai_usage.th_key')}</th>
                <th className="px-3 py-2">{t('admin.ai_usage.th_count')}</th>
                <th className="px-3 py-2">{t('admin.ai_usage.th_cost')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.key} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700">{row.key}</td>
                  <td className="px-3 py-2 text-slate-900">{row.count}</td>
                  <td className="px-3 py-2 text-slate-900">{row.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
