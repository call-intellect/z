import type { Metadata } from "next";

import { ChatboxIntegrationClient } from "../../../chats/integrations/chatbox/ChatboxIntegrationClient";

export const metadata: Metadata = {
  title: "Источник: Чат бокс",
};

export default function CompanyAdminChatboxSourcePage() {
  return <ChatboxIntegrationClient />;
}
