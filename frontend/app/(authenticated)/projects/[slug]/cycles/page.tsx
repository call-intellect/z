import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { CyclesClient } from './CyclesClient';

export const metadata: Metadata = {
  title: 'Спринты',
};

export default async function ProjectCyclesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <CyclesClient slug={slug} />
    </ProjectViewShell>
  );
}
