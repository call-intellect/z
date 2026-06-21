import type { Metadata } from "next";

import { ProbeSettingsClient } from "./ProbeSettingsClient";

export const metadata: Metadata = {
  title: "Probe и курация",
};

export default function AdminProbePage() {
  return <ProbeSettingsClient />;
}
