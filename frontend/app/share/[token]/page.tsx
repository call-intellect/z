import { ShareMeetingClient } from "./ShareMeetingClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export default async function PublicShareMeetingPage({ params }: Props) {
  const { token } = await params;
  return <ShareMeetingClient token={token} />;
}
