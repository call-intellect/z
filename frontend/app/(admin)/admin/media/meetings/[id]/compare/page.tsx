import type { Metadata } from "next";

import { AdminMeetingCompareSummaries } from "@/ui/components/admin/AdminMeetingCompareSummaries";

export const metadata: Metadata = {
  title: "Сравнение отчётов v2 vs fast",
};

type Props = { params: Promise<{ id: string }> };

export default async function CompareVersionsPage({ params }: Props) {
  const { id } = await params;
  return <AdminMeetingCompareSummaries meetingId={decodeURIComponent(id)} />;
}
