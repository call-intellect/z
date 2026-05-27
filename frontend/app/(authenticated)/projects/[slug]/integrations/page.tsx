import { ProjectViewShell } from '../ProjectViewShell';

import { IntegrationsClient } from './IntegrationsClient';

/**
 * `/projects/[slug]/integrations` — витрина приложений-интеграций проекта.
 *
 * Tracker Project Overview Часть 3 (2026-05-27).
 */
export default function ProjectIntegrationsPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <IntegrationsClient slug={params.slug} />
    </ProjectViewShell>
  );
}
