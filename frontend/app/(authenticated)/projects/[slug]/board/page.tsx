import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { BoardClient } from './BoardClient';

export const metadata: Metadata = {
  title: 'Доска',
};

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <BoardClient slug={slug} />
    </ProjectViewShell>
  );
}
