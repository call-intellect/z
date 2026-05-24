import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';

export const metadata: Metadata = {
  title: 'Гант — Z',
};

export default function ProjectGanttPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
        Диаграмма Ганта появится в Sprint 6 (опционально, по запросу).
      </div>
    </ProjectViewShell>
  );
}
