import type { Metadata } from "next";

import { MaintenanceClient } from "./MaintenanceClient";

export const metadata: Metadata = {
  title: "Бэкапы и обслуживание",
};

export default function AdminPlatformMaintenancePage() {
  return <MaintenanceClient />;
}
