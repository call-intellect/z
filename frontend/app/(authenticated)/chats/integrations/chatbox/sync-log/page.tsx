import type { Metadata } from "next";

import { ChatboxSyncLogClient } from "./ChatboxSyncLogClient";

export const metadata: Metadata = {
  title: "Журнал синхронизаций ChatBox",
};

export default function ChatboxSyncLogPage() {
  return <ChatboxSyncLogClient />;
}
