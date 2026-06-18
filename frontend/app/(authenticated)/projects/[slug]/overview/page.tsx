import { ProjectViewShell } from "../ProjectViewShell";

import { OverviewClient } from "./OverviewClient";

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
