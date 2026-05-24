import type { Metadata } from 'next';

import { ProjectViewShell } from '../ProjectViewShell';
import { BoardClient } from './BoardClient';

export const metadata: Metadata = {
  title: 'Доска — Z',
};

export default function ProjectBoardPage({
  params,
}: {
  params: { slug: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <BoardClient slug={params.slug} />
    </ProjectViewShell>
  );
}
