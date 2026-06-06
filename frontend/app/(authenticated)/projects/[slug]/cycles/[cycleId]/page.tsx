import type { Metadata } from 'next';

import { ProjectViewShell } from '../../ProjectViewShell';
import { CycleDetailClient } from './CycleDetailClient';

export const metadata: Metadata = {
  title: 'Спринт — Кора',
};

export default async function CycleDetailPage({
  params,
}: {
  params: Promise<{ slug: string; cycleId: string }>;
}) {
  const { slug, cycleId } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <CycleDetailClient cycleId={cycleId} />
    </ProjectViewShell>
  );
}
