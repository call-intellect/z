import type { Metadata } from 'next';
import type { JSX } from 'react';

import { CalendarView } from '@/ui/calendar/CalendarView';

import { ProjectViewShell } from '../ProjectViewShell';

export const metadata: Metadata = {
  title: 'Календарь проекта — Z',
};

export default function ProjectCalendarPage({
  params,
}: {
  params: { slug: string };
}): JSX.Element {
  return (
    <ProjectViewShell slug={params.slug}>
      <CalendarView mode="project" projectSlug={params.slug} />
    </ProjectViewShell>
  );
}
