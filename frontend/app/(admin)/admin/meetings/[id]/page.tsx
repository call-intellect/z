import { AdminMeetingDetails } from '@/ui/components/admin/AdminMeetingDetails';

type Props = { params: { id: string } };

export default function AdminMeetingDetailsPage({ params }: Props) {
  return <AdminMeetingDetails meetingId={decodeURIComponent(params.id)} />;
}
