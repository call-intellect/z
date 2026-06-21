import type { Metadata } from "next";

import { QuotasSettingsClient } from "./QuotasSettingsClient";

export const metadata: Metadata = {
  title: "Квоты пользователей",
};

export default function AdminPlatformQuotasPage() {
  return <QuotasSettingsClient />;
}
