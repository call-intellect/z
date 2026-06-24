import type { Metadata } from "next";

import { ChatboxChatViewClient } from "./ChatboxChatViewClient";

export const metadata: Metadata = {
  title: "Диалог ChatBox",
};

export default async function ChatboxChatViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ChatboxChatViewClient chatId={id} />;
}
