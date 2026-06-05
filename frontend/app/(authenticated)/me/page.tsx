import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MeTabsClient } from './MeTabsClient';

export const metadata: Metadata = {
  title: 'Я — Z',
};

/**
 * `/me` — личный кабинет сотрудника «Я» (ТЗ-E Фаза 1, R9).
 *
 * Один экран с вкладками: «Обзор» (профиль, карта должности, документы,
 * встречи), «Пульс», «Чем я полезен компании», «Чем я помогаю коллегам»,
 * «Мои обещания». Раньше это были пять отдельных страниц `/me/*` — теперь
 * старые URL редиректят на соответствующую вкладку (`?tab=`).
 *
 * Для manager (== member) это страница по умолчанию вместо /dashboard.
 *
 * `MeTabsClient` читает активную вкладку из `useSearchParams()` — в Next.js
 * App Router это требует Suspense-границы на уровне страницы.
 */
export default function MePage() {
  return (
    <Suspense fallback={null}>
      <MeTabsClient />
    </Suspense>
  );
}
