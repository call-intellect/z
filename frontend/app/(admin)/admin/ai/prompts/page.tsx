import type { Metadata } from "next";

import { PromptsAiClient } from "./PromptsAiClient";

export const metadata: Metadata = {
  title: "Промпты",
};

export default function AdminAiPromptsPage() {
  return <PromptsAiClient />;
}
