import { ProjectViewShell } from '../ProjectViewShell';

import { OverviewClient } from './OverviewClient';

/**
 * `/projects/[slug]/overview` — стартовая страница проекта.
 *
 * Tracker Project Overview (2026-05-27). ТЗ: plans/tz/2026-05-27-tracker-project-overview.md.
 */
export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <OverviewClient slug={slug} />
    </ProjectViewShell>
  );
}
