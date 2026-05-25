import type { Metadata } from 'next';

import { AdminMeetingDetails } from '@/ui/components/admin/AdminMeetingDetails';

export const metadata: Metadata = {
  title: 'Детали встречи — Z-Admin',
};

type Props = { params: Promise<{ id: string }> };

export default async function AdminMediaMeetingDetailsPage({ params }: Props) {
  const { id } = await params;
  return <AdminMeetingDetails meetingId={decodeURIComponent(id)} />;
}
