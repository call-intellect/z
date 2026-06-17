import type { Metadata } from "next";

import { EmbeddingsSettingsClient } from "./EmbeddingsSettingsClient";

export const metadata: Metadata = {
  title: "Эмбеддинги",
};

export default function AdminAiEmbeddingsPage() {
  return <EmbeddingsSettingsClient />;
}
