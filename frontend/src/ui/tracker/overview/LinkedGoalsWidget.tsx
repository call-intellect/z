'use client';

/**
 * Tracker Project Overview — связанные цели проекта.
 *
 * Уникальные goalId из задач проекта → список Goal с cachedAlignment.
 */

import type { OverviewLinkedGoalApi } from '@/domain/tracker/overview';

const GOAL_STATUS_LABEL: Record<string, string> = {
  active: 'В работе',
  achieved: 'Достигнута',
  abandoned: 'Отменена',
  cancelled: 'Отменена',
  paused: 'Приостановлена',
};

export function LinkedGoalsWidget({
  goals,
}: {
  goals: OverviewLinkedGoalApi[];
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <h3 className="text-sm font-medium text-fg-primary">Связанные цели</h3>

      {goals.length === 0 ? (
        <p className="mt-2 text-sm text-fg-tertiary">
          Задачи проекта не привязаны к целям.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {goals.map((g) => (
            <li
              key={g.id}
              className="flex items-center gap-3 rounded border border-border-subtle bg-bg-base p-2"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-fg-primary">
                  {g.name}
                </div>
                <div className="text-[11px] text-fg-tertiary">
                  {GOAL_STATUS_LABEL[g.status] ?? g.status}
                </div>
              </div>
              {g.cachedAlignment !== null ? (
                <div className="shrink-0 rounded bg-bg-overlay px-2 py-1 text-xs text-fg-secondary">
                  {g.cachedAlignment}%
                </div>
              ) : (
                <div className="shrink-0 text-xs text-fg-tertiary">—</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
