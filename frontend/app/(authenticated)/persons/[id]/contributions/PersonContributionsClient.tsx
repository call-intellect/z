'use client';

import { PersonSubpagesNav } from '@/ui/components/persons/PersonSubpagesNav';

import { ContributionsView } from '../../../me/contributions/ContributionsView';

/**
 * Тонкая клиентская обёртка вокруг общего `ContributionsView`, которая
 * добавляет навигацию по подстраницам карточки сотрудника (Фаза 1 ТЗ
 * 2026-06-01-dashboards-wow-polish).
 *
 * Используется только на `/persons/[id]/contributions`. На `/me/contributions`
 * нав не нужен — `ContributionsView` остаётся без изменений.
 */
export function PersonContributionsClient({ personId }: { personId: string }) {
  return (
    <div>
      <div className="mx-auto w-full max-w-5xl px-6 pt-6">
        <PersonSubpagesNav entityId={personId} />
      </div>
      <ContributionsView personId={personId} title="Профиль вклада сотрудника" />
    </div>
  );
}
