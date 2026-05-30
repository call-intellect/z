import type { Metadata } from 'next';

import { CalendarView } from '@/ui/calendar/CalendarView';

import { ProjectViewShell } from '../ProjectViewShell';

export const metadata: Metadata = {
  title: 'Календарь проекта — Z',
};

export default async function ProjectCalendarPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <CalendarView mode="project" projectSlug={slug} />
    </ProjectViewShell>
  );
}
