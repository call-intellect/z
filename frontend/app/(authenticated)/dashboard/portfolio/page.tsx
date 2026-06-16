import type { Metadata } from "next";

import { PortfolioDashboardClient } from "./PortfolioDashboardClient";

export const metadata: Metadata = {
  title: "Портфель целей",
};

export default function PortfolioDashboardPage() {
  return <PortfolioDashboardClient />;
}
