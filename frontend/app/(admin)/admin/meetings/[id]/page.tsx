import { AdminMeetingDetails } from '@/ui/components/admin/AdminMeetingDetails';

type Props = { params: Promise<{ id: string }> };

export default async function AdminMeetingDetailsPage({ params }: Props) {
  const { id } = await params;
  return <AdminMeetingDetails meetingId={decodeURIComponent(id)} />;
}
