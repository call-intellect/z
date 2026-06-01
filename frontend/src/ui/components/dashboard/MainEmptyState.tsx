'use client';

/**
 * MainEmptyState — полно-страничный empty-state для «своей пустой Org» в
 * DEMO-режиме. Заменяет Hero + Tabs целиком (правило 3 матрицы ЭТЗ
 * `2026-06-01-main-screen-umbrella.md`). Не показывается в эталонной Org
 * (там работа через эталонный demo_observer flow).
 *
 * Подключается в `DirectorDashboardClient` (Шаг В.1 зонтика) условием:
 *   isOwnOrg && subscriptionStatus === 'DEMO' && noData
 *
 * Источник: ТЗ demo-shared-org-model.md §5.6.
 */

import Link from 'next/link';
import { ArrowRight, Building2 } from 'lucide-react';

export type MainEmptyStateProps = {
  /** Если true — показать CTA «Вернуться в демо» (есть membership к эталону). */
  canReturnToDemo?: boolean;
  /** Колбэк для возврата в эталон — обычно дергает org-switcher. */
  onReturnToDemo?: () => void;
};

export function MainEmptyState({ canReturnToDemo = false, onReturnToDemo }: MainEmptyStateProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-border-default bg-bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-chip-info-bg text-chip-info-fg">
          <Building2 size={28} />
        </div>
        <h2 className="mb-3 text-2xl font-semibold text-fg-primary">
          Ваша компания пока пустая
        </h2>
        <p className="mb-6 text-sm leading-relaxed text-fg-secondary">
          Демо «ТехноСтрим» показал, как работает Кора. Чтобы создавать встречи,
          задачи и регламенты в своей компании — оплатите подписку.
        </p>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/settings/subscription"
            className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent/90"
          >
            Оплатить подписку
            <ArrowRight size={16} />
          </Link>
          {canReturnToDemo && onReturnToDemo ? (
            <button
              type="button"
              onClick={onReturnToDemo}
              className="inline-flex items-center justify-center rounded-md border border-border-default bg-bg-overlay/40 px-5 py-2.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-bg-overlay/80 hover:text-fg-primary"
            >
              Вернуться в демо
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
