import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CalendarView } from '@/ui/calendar/CalendarView';

import { ProjectViewShell } from '../../../ProjectViewShell';

export const metadata: Metadata = {
  title: 'Календарь доски — Z',
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
export default function ProjectBoardCalendarPage({
  params,
}: {
  params: { slug: string; boardId: string };
}): JSX.Element {
  return (
    <ProjectViewShell slug={params.slug}>
      <CalendarView mode="project" projectSlug={params.slug} />
    </ProjectViewShell>
  );
}
