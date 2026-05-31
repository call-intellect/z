'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';

import { adminLlmPreferenceDatasetApi } from '@/api/admin-llm-preference-dataset.api';
import {
  adminPreferenceSampleFromApi,
  type AdminPreferenceSampleDomain,
  type AdminPreferenceStatsApi,
} from '@/domain/admin-llm-preference-sample';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

type Filters = {
  taskType: string;
  label: '' | 'correct' | 'wrong' | 'misleading';
  from: string;
  to: string;
  limit: number;
};

const DEFAULT_FILTERS: Filters = {
  taskType: '',
  label: '',
  from: '',
  to: '',
  limit: 200,
};

const LABEL_RU: Record<string, string> = {
  correct: 'верно',
  wrong: 'неверно',
  misleading: 'вводит в заблуждение',
};

function labelVariant(
  label: string,
): 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'danger' {
  if (label === 'correct') return 'success';
  if (label === 'wrong') return 'danger';
  if (label === 'misleading') return 'warning';
  return 'outline';
}

export function PreferenceDatasetClient() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);

  const statsQ = useAdminQuery<AdminPreferenceStatsApi>(
    `preference-stats:${applied.from}:${applied.to}`,
    () =>
      adminLlmPreferenceDatasetApi.stats({
        from: applied.from || undefined,
        to: applied.to || undefined,
      }),
    [applied.from, applied.to],
  );

  const listQ = useAdminQuery<AdminPreferenceSampleDomain[]>(
    `preference-items:${JSON.stringify(applied)}`,
    async () => {
      const res = await adminLlmPreferenceDatasetApi.list({
        taskType: applied.taskType || undefined,
        label: applied.label || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        limit: applied.limit,
      });
      return res.items.map(adminPreferenceSampleFromApi);
    },
    [applied.taskType, applied.label, applied.from, applied.to, applied.limit],
  );

  const applyFilters = () => setApplied(filters);
  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
  };

  const downloadUrl = adminLlmPreferenceDatasetApi.downloadJsonlUrl({
    taskType: applied.taskType || undefined,
    label: applied.label || undefined,
    from: applied.from || undefined,
    to: applied.to || undefined,
    limit: 10_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Preference dataset</h1>
          <p className="text-sm text-fg-tertiary">
            Записи, которые куратор пометил как «верно», «неверно» или «вводит
            в заблуждение». Используются для оффлайн-обучения few-shot
            промптов специалистов LLM (taskType 3.x).
          </p>
        </div>
        <a href={downloadUrl} download>
          <Button size="sm" variant="outline">
            <Download size={14} className="mr-1.5" />
            Скачать JSONL (до 10 000)
          </Button>
        </a>
      </div>

      {/* ── Сводка ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
          Сводка
        </h2>
        {statsQ.isLoading && <AdminLoading rows={2} />}
        {!statsQ.isLoading && statsQ.isForbidden && <AdminForbidden />}
        {!statsQ.isLoading && statsQ.error && (
          <AdminError message={statsQ.error} onRetry={statsQ.refetch} />
        )}
        {!statsQ.isLoading && statsQ.data && (
          <StatsBlock stats={statsQ.data} />
        )}
      </section>

      {/* ── Фильтры ────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
          Фильтры
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col text-xs">
            <span className="mb-1 text-fg-tertiary">taskType</span>
            <input
              type="text"
              placeholder="напр. decision-extract"
              className="rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm"
              value={filters.taskType}
              onChange={(e) =>
                setFilters((f) => ({ ...f, taskType: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 text-fg-tertiary">label</span>
            <select
              className="rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm"
              value={filters.label}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  label: e.target.value as Filters['label'],
                }))
              }
            >
              <option value="">все</option>
              <option value="correct">верно</option>
              <option value="wrong">неверно</option>
              <option value="misleading">вводит в заблуждение</option>
            </select>
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 text-fg-tertiary">с даты (UTC)</span>
            <input
              type="date"
              className="rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm"
              value={filters.from}
              onChange={(e) =>
                setFilters((f) => ({ ...f, from: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 text-fg-tertiary">по дату (UTC)</span>
            <input
              type="date"
              className="rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm"
              value={filters.to}
              onChange={(e) =>
                setFilters((f) => ({ ...f, to: e.target.value }))
              }
            />
          </label>
          <label className="flex flex-col text-xs">
            <span className="mb-1 text-fg-tertiary">лимит (1–1000)</span>
            <input
              type="number"
              min={1}
              max={1000}
              className="rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm"
              value={filters.limit}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  limit: Math.max(1, Math.min(1000, Number(e.target.value) || 200)),
                }))
              }
            />
          </label>
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={applyFilters}>
            Применить
          </Button>
          <Button size="sm" variant="ghost" onClick={resetFilters}>
            Сбросить
          </Button>
        </div>
      </section>

      {/* ── Таблица ────────────────────────────────────────────── */}
      <section>
        {listQ.isLoading && <AdminLoading rows={5} />}
        {!listQ.isLoading && listQ.isForbidden && <AdminForbidden />}
        {!listQ.isLoading && listQ.error && (
          <AdminError message={listQ.error} onRetry={listQ.refetch} />
        )}
        {!listQ.isLoading && listQ.data && listQ.data.length === 0 && (
          <AdminEmpty
            title="Нет записей"
            description="Под текущие фильтры ничего не подходит. Попробуйте расширить диапазон дат или убрать фильтр по taskType/label."
          />
        )}
        {!listQ.isLoading && listQ.data && listQ.data.length > 0 && (
          <SamplesTable items={listQ.data} />
        )}
      </section>
    </div>
  );
}

function StatsBlock({ stats }: { stats: AdminPreferenceStatsApi }) {
  if (stats.total === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        За выбранный период записей нет.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums">
          {stats.total.toLocaleString('ru-RU')}
        </span>
        <span className="text-sm text-fg-tertiary">записей всего</span>
        {Object.entries(stats.byLabel).map(([label, count]) => (
          <Badge key={label} variant={labelVariant(label)}>
            {LABEL_RU[label] ?? label}: {count.toLocaleString('ru-RU')}
          </Badge>
        ))}
      </div>
      {stats.byTaskType.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-xs">
            <thead className="bg-bg-overlay text-fg-tertiary">
              <tr>
                <th className="px-3 py-1.5 text-left">taskType</th>
                <th className="px-3 py-1.5 text-right">верно</th>
                <th className="px-3 py-1.5 text-right">неверно</th>
                <th className="px-3 py-1.5 text-right">вводит в&nbsp;заблуждение</th>
                <th className="px-3 py-1.5 text-right">всего</th>
              </tr>
            </thead>
            <tbody>
              {stats.byTaskType.map((row) => (
                <tr
                  key={row.taskType}
                  className="border-t border-border-subtle"
                >
                  <td className="px-3 py-1.5 font-mono">{row.taskType}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.correct}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.wrong}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {row.misleading}
                  </td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                    {row.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SamplesTable({ items }: { items: AdminPreferenceSampleDomain[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Дата (UTC)</th>
            <th className="px-3 py-2 text-left">Org</th>
            <th className="px-3 py-2 text-left">taskType</th>
            <th className="px-3 py-2 text-left">label</th>
            <th className="px-3 py-2 text-left">Причина</th>
            <th className="px-3 py-2 text-left">Куратор</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr
              key={s.id}
              className="border-t border-border-subtle align-top hover:bg-bg-overlay"
            >
              <td className="px-3 py-2 whitespace-nowrap text-xs tabular-nums">
                {s.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
              </td>
              <td className="px-3 py-2 font-mono text-xs">{s.tenantId}</td>
              <td className="px-3 py-2 font-mono text-xs">{s.taskType}</td>
              <td className="px-3 py-2">
                <Badge variant={labelVariant(s.label)}>
                  {LABEL_RU[s.label] ?? s.label}
                </Badge>
              </td>
              <td className="px-3 py-2 max-w-md text-xs text-fg-secondary">
                {s.reason ?? <span className="text-fg-tertiary">—</span>}
              </td>
              <td className="px-3 py-2 font-mono text-xs">
                {s.recordedBy ?? <span className="text-fg-tertiary">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
