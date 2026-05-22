import type { Metadata } from 'next';

import { RoleSkillProfileClient } from './RoleSkillProfileClient';

export const metadata: Metadata = {
  title: 'Навыковый профиль роли — Кора',
};

/**
 * `/roles/:id/skill-profile` (SBA γ-1) — агрегатный навыковый профиль роли.
 *
 * Видимость: все, кто имеет read на role (по умолчанию все members Org).
 */
export default function RoleSkillProfilePage({
  params,
}: {
  params: { id: string };
}) {
  return <RoleSkillProfileClient roleId={params.id} />;
}
