import { redirect } from "next/navigation";

import { ExternalChatClient } from "@/ui/external-chat/ExternalChatClient";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function ExternalChatPage({ params }: Props) {
  const { token } = await params;
  if (!token || token.length < 16) {
    redirect("/");
  }

  return <ExternalChatClient token={token} />;
}
