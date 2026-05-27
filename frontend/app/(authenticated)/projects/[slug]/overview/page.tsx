import { ProjectViewShell } from '../ProjectViewShell';

import { OverviewClient } from './OverviewClient';

/**
 * `/projects/[slug]/overview` — стартовая страница проекта.
 *
 * Tracker Project Overview (2026-05-27). ТЗ: plans/tz/2026-05-27-tracker-project-overview.md.
 */
export default function ProjectOverviewPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <OverviewClient slug={params.slug} />
    </ProjectViewShell>
  );
}
