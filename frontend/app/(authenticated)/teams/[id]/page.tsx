import type { Metadata } from 'next';

import { TeamDetailClient } from './TeamDetailClient';

export const metadata: Metadata = {
  title: 'Команда',
};

/**
 * /teams/[id] — детальная страница команды (Pulse Wave 2 §2.5).
 *
 * Next 16 App Router: `params` приходит как Promise — обязательно `await`.
 */
export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeamDetailClient departmentId={id} />;
}
