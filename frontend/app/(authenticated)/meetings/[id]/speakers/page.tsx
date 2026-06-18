import { SpeakersScreen } from "@/ui/components/upload-recording/SpeakersScreen";

type Props = { params: Promise<{ id: string }> };

export default async function SpeakersPage({ params }: Props) {
  const { id } = await params;
  return <SpeakersScreen meetingId={id} />;
}
