import type { Metadata } from "next";

import { CurationSettingsClient } from "./CurationSettingsClient";

export const metadata: Metadata = {
  title: "Настройки проверки",
};

export default function CurationSettingsPage() {
  return <CurationSettingsClient />;
}
