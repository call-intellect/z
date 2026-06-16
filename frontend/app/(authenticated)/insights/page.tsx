import type { Metadata } from "next";

import { InsightsListClient } from "./InsightsListClient";

export const metadata: Metadata = {
  title: "Сигналы",
};

export default function InsightsPage() {
  return <InsightsListClient />;
}
