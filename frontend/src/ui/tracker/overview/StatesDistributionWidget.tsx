'use client';

/**
 * Tracker Project Overview — распределение задач по статусам.
 *
 * Простой stacked-bar + список 5 категорий с цветными точками.
 */

import {
  stateCategoryLabel,
  type OverviewStateBucketApi,
  type OverviewStateCategoryApi,
} from '@/domain/tracker/overview';

const CATEGORY_COLOR: Record<OverviewStateCategoryApi, string> = {
  backlog: 'bg-chip-sand-bg',
  unstarted: 'bg-chip-info-bg',
  started: 'bg-chip-lavender-bg',
  completed: 'bg-chip-success-bg',
  cancelled: 'bg-chip-danger-bg',
};

export function StatesDistributionWidget({
  buckets,
}: {
  buckets: OverviewStateBucketApi[];
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <h3 className="text-sm font-medium text-fg-primary">Распределение по статусам</h3>

      {total === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">Задач пока нет.</p>
      ) : (
        <>
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-bg-overlay">
            {buckets.map((b) =>
              b.count > 0 ? (
                <div
                  key={b.category}
                  className={CATEGORY_COLOR[b.category]}
                  style={{ width: `${(b.count / total) * 100}%` }}
                  aria-label={`${stateCategoryLabel(b.category)}: ${b.count}`}
                />
              ) : null,
            )}
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-fg-secondary md:grid-cols-5">
            {buckets.map((b) => (
              <li key={b.category} className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${CATEGORY_COLOR[b.category]}`}
                />
                <span className="truncate">{stateCategoryLabel(b.category)}</span>
                <span className="ml-auto tabular-nums text-fg-tertiary">
                  {b.count}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
