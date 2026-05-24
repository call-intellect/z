import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { CyclesClient } from './CyclesClient';

export const metadata: Metadata = {
  title: 'Циклы — Z',
};

export default function ProjectCyclesPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <CyclesClient slug={params.slug} />
    </ProjectViewShell>
  );
}
