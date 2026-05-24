import type { Metadata } from 'next';

import { ProjectViewShell } from '../../ProjectViewShell';
import { CycleDetailClient } from './CycleDetailClient';

export const metadata: Metadata = {
  title: 'Цикл — Z',
};

export default function CycleDetailPage({
  params,
}: {
  params: { slug: string; cycleId: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <CycleDetailClient cycleId={params.cycleId} />
    </ProjectViewShell>
  );
}
