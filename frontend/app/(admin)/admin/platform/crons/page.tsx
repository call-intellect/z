import type { Metadata } from "next";

import { CronsClient } from "./CronsClient";

export const metadata: Metadata = {
  title: "Расписания @Cron",
};

export default function AdminPlatformCronsPage() {
  return <CronsClient />;
}
