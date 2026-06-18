import { MeetingResultPageReal } from "@/ui/components/meeting-result-v2/MeetingResultPageReal";

type Props = { params: Promise<{ id: string }> };

export default async function MeetingResultPage({ params }: Props) {
  const { id } = await params;
  return <MeetingResultPageReal meetingId={id} />;
}
