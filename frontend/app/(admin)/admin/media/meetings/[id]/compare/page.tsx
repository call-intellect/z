import type { Metadata } from 'next';

import { AdminMeetingCompareSummaries } from '@/ui/components/admin/AdminMeetingCompareSummaries';

export const metadata: Metadata = {
  title: 'Сравнение отчётов v2 vs fast',
};

type Props = { params: Promise<{ id: string }> };

/**
 * Фаза 5 ТЗ meeting-report-split-from-block-ingest:
 * страница сравнения двух AI-отчётов (v2 vs fast) для одной встречи.
 * Доступ только под admin-guard (наследуется от /admin/ route-группы).
 */
export default async function CompareVersionsPage({ params }: Props) {
  const { id } = await params;
  return <AdminMeetingCompareSummaries meetingId={decodeURIComponent(id)} />;
}
