'use client';

/**
 * Tracker Project Overview — виджет активного цикла.
 *
 * Если у проекта есть Cycle с now BETWEEN start/end — показываем имя, даты,
 * прогресс. Если нет — placeholder со ссылкой на /cycles.
 */

import Link from 'next/link';

import type { ProjectActiveCycle } from '@/domain/tracker/overview';

function fmt(d: Date): string {
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
}

function readProgress(snap: unknown): {
  done: number;
  total: number;
  pct: number;
} | null {
  if (!snap || typeof snap !== 'object') return null;
  const s = snap as Record<string, unknown>;
  const total = typeof s.total === 'number' ? s.total : null;
  const done =
    typeof s.completed === 'number'
      ? s.completed
      : typeof s.done === 'number'
        ? s.done
        : null;
  if (total === null || done === null || total <= 0) return null;
  return { done, total, pct: Math.round((done / total) * 100) };
}

export function ActiveCycleWidget({
  projectSlug,
  cycle,
}: {
  projectSlug: string;
  cycle: ProjectActiveCycle | null;
}) {
  if (!cycle) {
    return (
      <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
        <h3 className="text-sm font-medium text-fg-primary">Активный цикл</h3>
        <p className="mt-2 text-sm text-fg-tertiary">
          Циклы в проекте не настроены.
        </p>
        <Link
          href={`/projects/${encodeURIComponent(projectSlug)}/cycles`}
          className="mt-3 inline-block text-sm text-accent hover:underline"
        >
          Создать цикл →
        </Link>
      </section>
    );
  }

  const progress = readProgress(cycle.progressSnapshot);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-fg-primary">{cycle.name}</h3>
        <span className="text-xs text-fg-tertiary">
          {fmt(cycle.startDate)} – {fmt(cycle.endDate)}
        </span>
      </div>

      {progress ? (
        <>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-overlay">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${progress.pct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-fg-tertiary">
            <span>
              {progress.done} из {progress.total} задач
            </span>
            <span>{progress.pct}%</span>
          </div>
        </>
      ) : (
        <p className="mt-2 text-xs text-fg-tertiary">
          Прогресс ещё не считался.
        </p>
      )}

      <Link
        href={`/projects/${encodeURIComponent(projectSlug)}/cycles/${encodeURIComponent(cycle.id)}`}
        className="mt-3 inline-block text-sm text-accent hover:underline"
      >
        Посмотреть цикл →
      </Link>
    </section>
  );
}
