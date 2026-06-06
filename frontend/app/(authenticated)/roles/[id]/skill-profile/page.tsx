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
export default async function RoleSkillProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoleSkillProfileClient roleId={id} />;
}
