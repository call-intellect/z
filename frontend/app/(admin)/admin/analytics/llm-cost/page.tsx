import type { Metadata } from "next";

import { LlmCostDashboardClient } from "./LlmCostDashboardClient";

export const metadata: Metadata = {
  title: "Расход на LLM",
};

export default function LlmCostDashboardPage() {
  return <LlmCostDashboardClient />;
}
