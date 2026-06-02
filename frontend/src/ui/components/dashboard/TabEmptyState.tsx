'use client';

/**
 * `TabEmptyState` — единый empty-state для таба главной CEO-дашборда.
 *
 * Показывается когда все виджеты таба пусты И ничего не loading. Заменяет
 * полотно «5 серых блоков с надписью недостаточно данных».
 *
 * Источник: ТЗ `2026-06-01-dashboard-main-tabs-restructure.md` Фаза 6.
 */

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { Calendar } from 'lucide-react';

export type TabEmptyStateProps = {
  /** Подпись таба (например, «Команда», «Знания»). */
  tabLabel: string;
  /** Иконка категории (48×48). По умолчанию Calendar. */
  icon?: LucideIcon;
  /** Опциональный текст под заголовком, если хочется конкретики таба. */
  hint?: string;
  /** Кнопка действия — по умолчанию «Создать встречу» на /meetings/new. */
  actionLabel?: string;
  actionHref?: string;
};

export function TabEmptyState({
  tabLabel,
  icon: Icon = Calendar,
  hint,
  actionLabel = 'Создать встречу',
  actionHref = '/meetings/new',
}: TabEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border-subtle/60 bg-bg-card p-8 text-center">
      <Icon size={48} strokeWidth={1.25} className="text-fg-tertiary" />
      <h3 className="text-base font-semibold text-fg-primary">
        В разделе «{tabLabel}» пока нет данных
      </h3>
      <p className="max-w-md text-sm text-fg-secondary">
        {hint ??
          'Этот раздел заполнится после первой встречи с командой. Подключите календарь или проведите встречу через Кору.'}
      </p>
      <Link
        href={actionHref}
        className="mt-2 inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
      >
        {actionLabel}
      </Link>
    </div>
  );
}
