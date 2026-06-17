import type { Metadata } from "next";

import { KnowledgeCoreSettingsClient } from "./KnowledgeCoreSettingsClient";

export const metadata: Metadata = {
  title: "Knowledge-Core настройки",
};

export default function AdminAiKnowledgeCorePage() {
  return <KnowledgeCoreSettingsClient />;
}
