import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { ListClient } from './ListClient';

export const metadata: Metadata = {
  title: 'Список задач — Z',
};

export default function ProjectListPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <ListClient slug={params.slug} />
    </ProjectViewShell>
  );
}
