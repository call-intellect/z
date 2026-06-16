import type { Metadata } from "next";

import { DashboardRouter } from "./DashboardRouter";

export const metadata: Metadata = {
  title: "Главная",
};

export default function DashboardPage() {
  return <DashboardRouter />;
}
