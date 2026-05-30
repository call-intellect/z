import type { Metadata } from 'next';

import { PersonPulseClient } from './PersonPulseClient';

export const metadata: Metadata = { title: 'Карточка сотрудника — Кора' };

/**
 * `/persons/:id/pulse` — Pulse-карточка сотрудника (Wave 3 §3.4 + §3.6 + §3.8).
 *
 * Доступ (RBAC backend): owner/admin/coo/super_admin ИЛИ сам сотрудник
 * (Person.userId === currentUser.id). Manager — пока нет (см. ТЗ §7.2).
 */
export default async function PersonPulsePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonPulseClient personId={id} />;
}
