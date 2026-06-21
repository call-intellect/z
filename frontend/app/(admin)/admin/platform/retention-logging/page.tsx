import type { Metadata } from "next";

import { RetentionLoggingSettingsClient } from "./RetentionLoggingSettingsClient";

export const metadata: Metadata = {
  title: "Хранение и логи",
};

export default function AdminPlatformRetentionLoggingPage() {
  return <RetentionLoggingSettingsClient />;
}
