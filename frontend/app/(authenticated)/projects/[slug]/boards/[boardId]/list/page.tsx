import type { Metadata } from 'next';

import { ProjectViewShell } from '../../../ProjectViewShell';

import { ListClient } from './ListClient';

export const metadata: Metadata = {
  title: 'Список задач',
};

/**
 * Tracker Boards (2026-05-27) — список задач выбранной доски.
 * Маршрут: `/projects/[slug]/boards/[boardId]/list`.
 */
export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ slug: string; boardId: string }>;
}) {
  const { slug, boardId } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <ListClient slug={slug} boardId={boardId} />
    </ProjectViewShell>
  );
}
