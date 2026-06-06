import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { ListClient } from './ListClient';

export const metadata: Metadata = {
  title: 'Список задач — Кора',
};

export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <ListClient slug={slug} />
    </ProjectViewShell>
  );
}
