import type { Metadata } from "next";

import { LimitsClient } from "./LimitsClient";

export const metadata: Metadata = {
  title: "Глобальные лимиты",
};

export default function AdminPlatformLimitsPage() {
  return <LimitsClient />;
}
