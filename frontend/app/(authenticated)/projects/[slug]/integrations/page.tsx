import { ProjectViewShell } from "../ProjectViewShell";

import { IntegrationsClient } from "./IntegrationsClient";

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
