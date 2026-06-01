import type { Metadata } from 'next';

import { PersonContributionsClient } from './PersonContributionsClient';

export const metadata: Metadata = {
  title: 'Профиль сотрудника — Z',
};

/**
 * T1 (2026-05-23) — `/persons/[id]/contributions`.
 *
 * Read-only профиль вклада сотрудника. Доступ только руководителю
 * (rbac.check act='manage', obj='org' — owner / admin Org). Если нет
 * прав — backend вернёт 403, и страница покажет «недоступно».
 *
 * Не показываем тоггл opt-out — это управляется только самим сотрудником.
 *
 * 2026-06-01 dashboards-wow-polish Фаза 1: оборачиваем общий
 * `ContributionsView` в `PersonContributionsClient`, чтобы добавить
 * горизонтальную навигацию `PersonSubpagesNav` по подстраницам карточки.
 */
export default function PersonContributionsPage({
  params,
}: {
  params: { id: string };
}) {
  return <PersonContributionsClient personId={params.id} />;
}
