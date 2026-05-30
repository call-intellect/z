import { ProjectViewShell } from '../ProjectViewShell';

import { WorkloadClient } from './WorkloadClient';

/**
 * `/projects/[slug]/workload` — таблица «Загруженность» (участник × состояние).
 *
 * Tracker Project Overview Часть 2 (2026-05-27).
 */
export default async function ProjectWorkloadPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <WorkloadClient slug={slug} />
    </ProjectViewShell>
  );
}
