import type { Metadata } from "next";

import { TrackerSettingsClient } from "./TrackerSettingsClient";

export const metadata: Metadata = {
  title: "Трекер",
};

export default function AdminTrackerPage() {
  return <TrackerSettingsClient />;
}
