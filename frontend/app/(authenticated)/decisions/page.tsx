import type { Metadata } from "next";

import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileMemoryClient } from "@/ui/mobile/manager/MobileMemoryClient";

import { DecisionsListClient } from "./DecisionsListClient";

export const metadata: Metadata = {
  title: "Решения",
};

export default function DecisionsPage() {
  return (
    <MobileShell
      mobile={<MobileMemoryClient />}
      desktop={<DecisionsListClient />}
    />
  );
}
