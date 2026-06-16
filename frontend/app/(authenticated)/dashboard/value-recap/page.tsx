import type { Metadata } from "next";

import { ValueRecapDashboardClient } from "./ValueRecapDashboardClient";

export const metadata: Metadata = {
  title: "Что Кора сделала",
};

export default function ValueRecapDashboardPage() {
  return <ValueRecapDashboardClient />;
}
