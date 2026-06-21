import type { Metadata } from "next";

import { ConciergeSettingsClient } from "./ConciergeSettingsClient";

export const metadata: Metadata = {
  title: "Помощник",
};

export default function AdminAiConciergePage() {
  return <ConciergeSettingsClient />;
}
