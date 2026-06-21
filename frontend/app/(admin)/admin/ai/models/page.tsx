import type { Metadata } from "next";

import { ModelsSettingsClient } from "./ModelsSettingsClient";

export const metadata: Metadata = {
  title: "Модели LLM и часы",
};

export default function AdminAiModelsPage() {
  return <ModelsSettingsClient />;
}
