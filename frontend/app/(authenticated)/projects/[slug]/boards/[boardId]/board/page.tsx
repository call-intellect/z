import type { Metadata } from 'next';

import { ProjectViewShell } from '../../../ProjectViewShell';

import { BoardClient } from './BoardClient';

export const metadata: Metadata = {
  title: 'Доска — Z',
};

/**
 * Tracker Boards (2026-05-27) — канбан выбранной доски.
 * Маршрут: `/projects/[slug]/boards/[boardId]/board`.
 */
export default function ProjectBoardPage({
  params,
}: {
  params: { slug: string; boardId: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <BoardClient slug={params.slug} boardId={params.boardId} />
    </ProjectViewShell>
  );
}
