import { ShareClipClient } from "./ShareClipClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export default async function PublicShareClipPage({ params }: Props) {
  const { token } = await params;
  return <ShareClipClient token={token} />;
}
