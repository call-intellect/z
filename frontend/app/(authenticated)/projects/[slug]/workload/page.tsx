import { ProjectViewShell } from '../ProjectViewShell';

import { WorkloadClient } from './WorkloadClient';

/**
 * `/projects/[slug]/workload` — таблица «Загруженность» (участник × состояние).
 *
 * Tracker Project Overview Часть 2 (2026-05-27).
 */
export default function ProjectWorkloadPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <WorkloadClient slug={params.slug} />
    </ProjectViewShell>
  );
}
