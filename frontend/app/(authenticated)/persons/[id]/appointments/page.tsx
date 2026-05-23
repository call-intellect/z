import type { Metadata } from 'next';

import { PersonAppointmentsClient } from './PersonAppointmentsClient';

export const metadata: Metadata = {
  title: 'История назначений — Z',
};

/**
 * SBA α-8 wave 4 — детальная страница timeline назначений сотрудника.
 *
 * Дополняет краткую секцию в `PersonDetailClient`: здесь — полный список
 * с длительностями, отделами, нагрузкой и статусом каждого назначения.
 *
 * URL: /persons/[entityId]/appointments — entityId это Entity{type=person}.id
 * (как и в `/persons/[id]`), резолв в Person делается на бэке через
 * Person.entityId.
 */
export default async function PersonAppointmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonAppointmentsClient entityId={id} />;
}
