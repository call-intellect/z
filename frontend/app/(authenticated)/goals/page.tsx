import type { Metadata } from "next";

import { TierGate } from "@/ui/components/TierGate";
import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileGoalsClient } from "@/ui/mobile/exec/MobileGoalsClient";

import { GoalsClient } from "./GoalsClient";

export const metadata: Metadata = {
  title: "Цели",
};

export default function GoalsPage() {
  return (
    <TierGate feature="feature.goals_strategy">
      <MobileShell mobile={<MobileGoalsClient />} desktop={<GoalsClient />} />
    </TierGate>
  );
}
