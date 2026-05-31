import { permanentRedirect } from 'next/navigation';

type Props = { params: Promise<{ id: string }> };

export default async function AdminMeetingDetailsRedirectPage({ params }: Props) {
  const { id } = await params;
  permanentRedirect(`/admin/media/meetings/${encodeURIComponent(id)}`);
}
