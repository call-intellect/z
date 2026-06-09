import type { Metadata } from 'next';

import { CalendarView } from '@/ui/calendar/CalendarView';

import { ProjectViewShell } from '../../../ProjectViewShell';

export const metadata: Metadata = {
  title: 'Календарь доски',
};

/**
 * Tracker Boards (2026-05-27) — календарь выбранной доски.
 * Маршрут: `/projects/[slug]/boards/[boardId]/calendar`.
 *
 * NB: `CalendarView` сейчас работает на уровне проекта (mode='project'),
 * фильтрации по boardId внутри пока нет — оставлено как заглушка под
 * следующую итерацию. Для UX MVP достаточно — переключатель досок
 * остаётся в сайдбаре.
 */
export default async function ProjectBoardCalendarPage({
  params,
}: {
  params: Promise<{ slug: string; boardId: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <CalendarView mode="project" projectSlug={slug} />
    </ProjectViewShell>
  );
}
