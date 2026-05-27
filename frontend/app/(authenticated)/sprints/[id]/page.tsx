import type { Metadata } from 'next';

import { SprintDashboardClient } from './SprintDashboardClient';

export const metadata: Metadata = {
  title: 'Спринт — Z',
};

export default function SprintDashboardPage({
  params,
}: {
  params: { id: string };
}) {
  return <SprintDashboardClient cycleId={params.id} />;
}
