import type { Metadata } from 'next';

import { ProjectViewShell } from '../../../ProjectViewShell';

import { ListClient } from './ListClient';

export const metadata: Metadata = {
  title: 'Список задач — Z',
};

/**
 * Tracker Boards (2026-05-27) — список задач выбранной доски.
 * Маршрут: `/projects/[slug]/boards/[boardId]/list`.
 */
export default function ProjectListPage({
  params,
}: {
  params: { slug: string; boardId: string };
}) {
  return (
    <ProjectViewShell slug={params.slug}>
      <ListClient slug={params.slug} boardId={params.boardId} />
    </ProjectViewShell>
  );
}
