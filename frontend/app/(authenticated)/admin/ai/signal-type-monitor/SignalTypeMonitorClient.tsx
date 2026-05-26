'use client';

import { useMemo, useState } from 'react';

import { adminSignalTypeMonitorApi } from '@/api/admin-signal-type-monitor.api';
import {
  adminSignalTypeMonitorItemFromApi,
  type AdminSignalTypeMonitorItemDomain,
} from '@/domain/admin-signal-type-monitor';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

export function SignalTypeMonitorClient() {
  const q = useAdminQuery<AdminSignalTypeMonitorItemDomain[]>(
    'signal-type-monitor:list',
    async () => {
      const res = await adminSignalTypeMonitorApi.list();
      return res.items.map(adminSignalTypeMonitorItemFromApi);
    },
  );

  const [selectedTenant, setSelectedTenant] = useState<string | null>(null);
  const active = useMemo<AdminSignalTypeMonitorItemDomain | null>(() => {
    if (!q.data || q.data.length === 0) return null;
    if (selectedTenant) {
      return q.data.find((i) => i.tenantId === selectedTenant) ?? q.data[0]!;
    }
    return q.data[0]!;
  }, [q.data, selectedTenant]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Мониторинг signalType</h1>
        <p className="text-sm text-fg-tertiary">
          Распределение типов смысловых сигналов за 7 дней и матрица переходов
          (от какого типа к какому в рамках одного исходного события). Данные
          рассчитываются каждый день в 02:00 UTC и используются Prometheus
          для алерта дрейфа классификатора.
        </p>
      </div>

      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.length === 0 && (
        <AdminEmpty
          title="Нет данных"
          description="Рассчитанных матриц ещё нет. Подождите следующего прогона cron-задачи `signal-type-stats` (ежедневно в 02:00 UTC) или убедитесь, что в системе уже есть canonical IdeaBlock'и."
        />
      )}

      {!q.isLoading && q.data && q.data.length > 0 && active && (
        <>
          {q.data.length > 1 && (
            <OrgPicker
              items={q.data}
              activeTenantId={active.tenantId}
              onChange={setSelectedTenant}
            />
          )}
          <OrgPanel item={active} />
        </>
      )}
    </div>
  );
}

function OrgPicker({
  items,
  activeTenantId,
  onChange,
}: {
  items: AdminSignalTypeMonitorItemDomain[];
  activeTenantId: string;
  onChange: (tenantId: string) => void;
}) {
  return (
    <label className="flex flex-col text-xs">
      <span className="mb-1 text-fg-tertiary">Org</span>
      <select
        className="max-w-md rounded-md border border-border-subtle bg-bg-overlay px-2 py-1.5 text-sm"
        value={activeTenantId}
        onChange={(e) => onChange(e.target.value)}
      >
        {items.map((i) => (
          <option key={i.tenantId} value={i.tenantId}>
            {i.tenantName ?? i.tenantId} ({i.tenantId.slice(0, 8)}…)
          </option>
        ))}
      </select>
    </label>
  );
}

function OrgPanel({ item }: { item: AdminSignalTypeMonitorItemDomain }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3 rounded-lg border border-border-subtle bg-bg-card p-3">
        <span className="text-sm">
          <span className="text-fg-tertiary">Org:</span>{' '}
          <span className="font-medium">
            {item.tenantName ?? item.tenantId}
          </span>
        </span>
        <span className="text-xs text-fg-tertiary">
          Рассчитано:{' '}
          {item.calculatedAt
            ? item.calculatedAt
                .toISOString()
                .slice(0, 16)
                .replace('T', ' ') + ' UTC'
            : '—'}
        </span>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
          Распределение за 7 дней
        </h2>
        <Distribution dist={item.distribution7d} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-fg-tertiary">
          Матрица переходов (за 30 дней)
        </h2>
        <p className="mb-2 text-xs text-fg-tertiary">
          Строка — signalType исходного блока, столбец — следующего блока
          в рамках того же rawEvent. Цвет ячейки тем темнее, чем больше
          переходов.
        </p>
        <TransitionMatrix matrix={item.matrix} />
      </section>
    </div>
  );
}

function Distribution({ dist }: { dist: Record<string, number> }) {
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        За последние 7 дней нет canonical-блоков.
      </p>
    );
  }
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => {
        const pct = max > 0 ? (v / max) * 100 : 0;
        return (
          <div key={k} className="flex items-center gap-3 text-sm">
            <div className="w-36 shrink-0 font-mono text-xs">{k}</div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-bg-overlay">
              <div
                className="h-full bg-accent/70"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <div className="w-12 shrink-0 text-right text-xs tabular-nums">
              {v}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TransitionMatrix({
  matrix,
}: {
  matrix: Record<string, Record<string, number>>;
}) {
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    for (const [from, row] of Object.entries(matrix)) {
      set.add(from);
      for (const to of Object.keys(row)) set.add(to);
    }
    return Array.from(set).sort();
  }, [matrix]);

  const max = useMemo(() => {
    let m = 0;
    for (const row of Object.values(matrix)) {
      for (const v of Object.values(row)) {
        if (v > m) m = v;
      }
    }
    return m;
  }, [matrix]);

  if (allKeys.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        Переходов между signalType за 30 дней нет (мало данных или каждый
        rawEvent дал ровно один блок).
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="text-xs">
        <thead className="bg-bg-overlay">
          <tr>
            <th className="px-2 py-1.5 text-left font-mono text-fg-tertiary">
              from \\ to
            </th>
            {allKeys.map((to) => (
              <th
                key={to}
                className="px-2 py-1.5 text-center font-mono text-fg-tertiary"
              >
                {to}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allKeys.map((from) => (
            <tr key={from} className="border-t border-border-subtle">
              <td className="px-2 py-1.5 font-mono text-fg-tertiary">
                {from}
              </td>
              {allKeys.map((to) => {
                const v = matrix[from]?.[to] ?? 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <td
                    key={to}
                    className="px-2 py-1.5 text-center tabular-nums"
                    style={{
                      backgroundColor:
                        v > 0
                          ? `rgba(99, 102, 241, ${0.15 + 0.5 * intensity})`
                          : undefined,
                    }}
                    title={`${from} → ${to}: ${v}`}
                  >
                    {v > 0 ? v : <span className="text-fg-tertiary">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
