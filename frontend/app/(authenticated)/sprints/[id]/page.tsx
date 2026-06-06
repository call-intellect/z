import type { Metadata } from 'next';

import { SprintDashboardClient } from './SprintDashboardClient';

export const metadata: Metadata = {
  title: 'Спринт — Z',
};

export default async function SprintDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <SprintDashboardClient cycleId={id} />;
}
