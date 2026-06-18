import type { Metadata } from "next";

import { CloneChatClient } from "./CloneChatClient";

export const metadata: Metadata = {
  title: "Диалог с клоном",
};

export default async function CloneChatPage({
  params,
}: {
  params: Promise<{ roleId: string; conversationId: string }>;
}) {
  const { roleId, conversationId } = await params;
  return <CloneChatClient roleId={roleId} conversationId={conversationId} />;
}
