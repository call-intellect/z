import type { Metadata } from "next";

import { WorkerKnobsSettingsClient } from "./WorkerKnobsSettingsClient";

export const metadata: Metadata = {
  title: "Рубильники воркеров",
};

export default function AdminPlatformWorkerKnobsPage() {
  return <WorkerKnobsSettingsClient />;
}
