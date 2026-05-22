import type { Metadata } from 'next';

import { PersonSkillProfileClient } from './PersonSkillProfileClient';

export const metadata: Metadata = {
  title: 'Навыковый профиль сотрудника — Кора',
};

/**
 * `/persons/:id/skill-profile` (SBA γ-1) — навыковый профиль сотрудника.
 *
 * Видимость: owner / admin / direct manager / сам носитель.
 * Действие mark_as_misleading доступно только direct manager / admin.
 */
export default function PersonSkillProfilePage({
  params,
}: {
  params: { id: string };
}) {
  return <PersonSkillProfileClient personId={params.id} />;
}
