import type { Metadata } from "next";

import { CalendarView } from "@/ui/calendar/CalendarView";

import { ProjectViewShell } from "../../../ProjectViewShell";

export const metadata: Metadata = {
  title: "Календарь доски",
};

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
