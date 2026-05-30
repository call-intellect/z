import { ProjectViewShell } from '../ProjectViewShell';

import { IntegrationsClient } from './IntegrationsClient';

/**
 * `/projects/[slug]/integrations` — витрина приложений-интеграций проекта.
 *
 * Tracker Project Overview Часть 3 (2026-05-27).
 */
export default async function ProjectIntegrationsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <IntegrationsClient slug={slug} />
    </ProjectViewShell>
  );
}
