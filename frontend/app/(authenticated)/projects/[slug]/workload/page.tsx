import { ProjectViewShell } from "../ProjectViewShell";

import { WorkloadClient } from "./WorkloadClient";

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
