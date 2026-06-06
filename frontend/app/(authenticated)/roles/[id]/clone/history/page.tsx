import type { Metadata } from 'next';

import { RoleCloneHistoryClient } from './RoleCloneHistoryClient';

export const metadata: Metadata = {
  title: 'История клона должности — Кора',
};

/**
 * `/roles/:id/clone/history` (Clones=Roles Ф4) — таблица версий клона роли.
 *
 * Каждая версия — отдельный `ExecutablePersona(scope='role')`. Период:
 *   - validFrom = snapshotAt этой версии;
 *   - validUntil = snapshotAt следующей версии или null (для текущей).
 *
 * Видны: версия, носитель в этот период, confidence, traits count.
 * Empty state: «У клона пока единственная версия (v1)».
 */
export default async function RoleCloneHistoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleCloneHistoryClient roleId={id} />;
}
