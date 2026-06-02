'use client';

/**
 * `PeopleAtRiskWidget` — топ-3 сотрудника с самым низким Pulse score за неделю.
 *
 * Источник правды (когда появится): backend endpoint `/dashboard/people-at-risk`
 * с ranked-списком Person'ов по Pulse score. См. реестр Фазы 0 раздел 4.4
 * «Открытые хвосты» — `docs/reference/dashboards-registry.md`.
 *
 * Сейчас (пока endpoint'а нет): виджет рендерит `null`, что соответствует
 * правилу Фазы 6 — «пустой виджет скрывается, родитель не показывает плейсхолдер».
 * Когда появится endpoint — заменить заглушку на реальный fetch + рендер
 * 3 строк (аватар → имя+роль → `MiniDonut` с Pulse + ссылка `/persons/{id}/pulse`).
 *
 * Источник: ТЗ `2026-06-01-dashboard-main-tabs-restructure.md` Фаза 7.
 */

import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

export type PeopleAtRiskItem = {
  personId: string;
  name: string;
  roleLabel?: string | null;
  /** 0..100, чем ниже — тем критичнее. */
  pulseScore: number;
};

export type PeopleAtRiskWidgetProps = {
  /** Топ-3 сотрудника с риском. Если null — fetch ещё не реализован → виджет скрыт. */
  items?: ReadonlyArray<PeopleAtRiskItem> | null;
  loading?: boolean;
};

export function PeopleAtRiskWidget({ items = null, loading = false }: PeopleAtRiskWidgetProps) {
  // Backend endpoint /dashboard/people-at-risk пока не реализован — виджет скрыт.
  if (items === null) return null;
  if (loading) return null;

  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-chip-success-bg bg-chip-success-bg/15 px-4 py-3">
        <CheckCircle2 size={16} className="shrink-0 text-chip-success-fg" />
        <p className="text-sm text-fg-primary">Все сотрудники в норме — нет тех, кто проседает по Pulse.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border-subtle/60 bg-bg-card p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
        Сотрудники под риском
      </h3>
      <ul className="space-y-2">
        {items.slice(0, 3).map((it) => {
          const tone = it.pulseScore < 30 ? 'danger' : it.pulseScore < 60 ? 'warning' : 'success';
          const toneBg =
            tone === 'danger' ? 'bg-chip-danger-bg/15 hover:bg-chip-danger-bg/25'
            : tone === 'warning' ? 'bg-chip-warning-bg/15 hover:bg-chip-warning-bg/25'
            : 'bg-chip-success-bg/15 hover:bg-chip-success-bg/25';
          const toneFg =
            tone === 'danger' ? 'text-chip-danger-fg'
            : tone === 'warning' ? 'text-chip-warning-fg'
            : 'text-chip-success-fg';
          const initials = it.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
          return (
            <li key={it.personId}>
              <Link
                href={`/persons/${encodeURIComponent(it.personId)}/pulse`}
                className={`group flex items-center gap-3 rounded-lg p-2 transition-colors ${toneBg}`}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-overlay text-xs font-medium text-fg-secondary">
                  {initials || '?'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-fg-primary">{it.name}</div>
                  {it.roleLabel ? (
                    <div className="truncate text-xs text-fg-tertiary">{it.roleLabel}</div>
                  ) : null}
                </div>
                <span className={`text-sm font-semibold ${toneFg}`}>{it.pulseScore}</span>
                <ArrowRight size={14} className="text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
