'use client';

import Link from 'next/link';

import {
  CAUSE_CATEGORY_BAR_CLASS,
  CAUSE_CATEGORY_LABELS_RU,
  CAUSE_CATEGORY_ORDER,
} from '@/lib/cause-category-presentation';
import type { InsightCauseCategoryAggregateApi } from '@/api/operations-dashboard.api';

/**
 * SBA β-8.3 Wave 2 — виджет «Карта причин недели».
 *
 * Показывает 8 горизонтальных столбиков (фиксированный порядок из
 * `CAUSE_CATEGORY_ORDER`) — сколько insight'ов попало в каждую категорию
 * за 7 дней (severity ≥ medium). Длина столбика пропорциональна max-value
 * среди всех 8 категорий. Каждая строка — ссылка-фильтр на /insights.
 *
 * Источник данных — `OperationsOverviewDomain.insightsByCauseCategory`
 * (см. `frontend/src/domain/operations-dashboard.ts`). Все строки на русском.
 */
export function CauseCategoryMapWidget(props: {
  insightsByCauseCategory: InsightCauseCategoryAggregateApi;
}) {
  const counts = props.insightsByCauseCategory;
  const total = CAUSE_CATEGORY_ORDER.reduce((acc, k) => acc + (counts[k] ?? 0), 0);
  const max = CAUSE_CATEGORY_ORDER.reduce(
    (m, k) => Math.max(m, counts[k] ?? 0),
    0,
  );

  return (
    <section className="rounded border border-border-subtle bg-bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg-primary">
          Карта причин недели
        </h2>
        <span className="text-xs text-fg-tertiary">всего сигналов: {total}</span>
      </div>
      <p className="mb-3 text-xs text-fg-secondary">
        Распределение новых сигналов за 7 дней по корневой причине. Кликните
        категорию, чтобы открыть их в радаре.
      </p>
      {total === 0 ? (
        <p className="rounded border border-border-subtle bg-bg-overlay p-3 text-sm text-fg-secondary">
          За последние 7 дней новых сигналов средней / высокой важности нет.
        </p>
      ) : (
        <ul className="space-y-2">
          {CAUSE_CATEGORY_ORDER.map((key) => {
            const value = counts[key] ?? 0;
            const widthPct = max > 0 ? Math.round((value / max) * 100) : 0;
            return (
              <li key={key}>
                <Link
                  href={`/insights?cause_category=${key}`}
                  className="group block rounded-md px-2 py-1.5 transition-colors hover:bg-bg-overlay"
                  aria-label={`Открыть сигналы — ${CAUSE_CATEGORY_LABELS_RU[key]} (${value})`}
                >
                  <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                    <span className="truncate text-fg-secondary group-hover:text-fg-primary">
                      {CAUSE_CATEGORY_LABELS_RU[key]}
                    </span>
                    <span className="tabular-nums text-xs text-fg-tertiary">
                      {value}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-bg-overlay">
                    <div
                      className={`h-full rounded-full ${CAUSE_CATEGORY_BAR_CLASS[key]}`}
                      style={{ width: `${widthPct}%` }}
                      aria-hidden
                    />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
