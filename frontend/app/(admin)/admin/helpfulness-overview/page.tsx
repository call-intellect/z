import type { Metadata } from "next";

import { HelpfulnessOverviewClient } from "./HelpfulnessOverviewClient";

export const metadata: Metadata = {
  title: "Помощь в команде",
};

export default function HelpfulnessOverviewPage() {
  return <HelpfulnessOverviewClient />;
}
