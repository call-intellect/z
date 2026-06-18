import type { Metadata } from "next";

import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileTeamClient } from "@/ui/mobile/exec/MobileTeamClient";

import { OperationsDashboardClient } from "./OperationsDashboardClient";

export const metadata: Metadata = {
  title: "Аналитика",
};

export default function OperationsDashboardPage() {
  return (
    <MobileShell
      mobile={<MobileTeamClient />}
      desktop={<OperationsDashboardClient />}
    />
  );
}
