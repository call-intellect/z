import type { Metadata } from 'next';

import { RoleCloneClient } from './RoleCloneClient';

export const metadata: Metadata = {
  title: 'Клон должности — Кора',
};

/**
 * `/roles/:id/clone` (Clones=Roles Ф4) — детали ролевого клона.
 *
 * Шапка: «Клон <Role.name> v<N>», текущий носитель, confidence-бар,
 * lastBuildAt. Кнопка «Спросить клона» → диалог через
 * `clonesApi.askRole(roleId, question)`. Кнопка «История версий» →
 * `/roles/:id/clone/history`. Кнопка «Обновить клона» (manual rebuild)
 * на Ф4 — заглушка с tooltip «доступно владельцу/администратору» (RBAC
 * для ролевого rebuild ещё не реализован на бэке).
 */
export default function RoleClonePage({
  params,
}: {
  params: { id: string };
}) {
  return <RoleCloneClient roleId={params.id} />;
}
