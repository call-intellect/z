import type { Metadata } from 'next';

import { PersonKnowledgeProfileClient } from './PersonKnowledgeProfileClient';

export const metadata: Metadata = {
  title: 'Профиль знаний',
};

/**
 * `/persons/[id]/knowledge-profile` (SBA β-2) — Профиль знаний другого
 * сотрудника. `[id]` — это Person.id (из модуля Persons ЛК). Если в системе
 * фигурирует только Entity{type=person}.id, нужно сначала найти Person по
 * entityId через `/api/v1/persons?entityId=...`.
 *
 * Доступ: все member'ы Org (RBAC `knowledge_profile.read`). Member видит
 * только сводку без цитат; owner/admin — полную информацию с цитатами.
 */
export default async function PersonKnowledgeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonKnowledgeProfileClient personId={id} />;
}
