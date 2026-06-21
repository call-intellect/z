import type { Metadata } from "next";

import { OrchestratorSettingsClient } from "./OrchestratorSettingsClient";

export const metadata: Metadata = {
  title: "Оркестратор и маршрутизатор",
};

export default function AdminAiOrchestratorPage() {
  return <OrchestratorSettingsClient />;
}
