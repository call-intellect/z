import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';

export const metadata: Metadata = {
  title: 'Календарь — Z',
};

export default function ProjectCalendarPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-12 text-center text-sm text-fg-tertiary">
        Календарь задач по dueDate появится в Sprint 4.
      </div>
    </ProjectViewShell>
  );
}
