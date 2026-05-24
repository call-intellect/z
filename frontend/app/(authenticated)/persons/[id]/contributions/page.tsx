import type { Metadata } from 'next';

import { ContributionsView } from '../../../me/contributions/ContributionsView';

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
 */
export default function PersonContributionsPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <ContributionsView personId={params.id} title="Профиль вклада сотрудника" />
  );
}
