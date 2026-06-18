import type { Metadata } from "next";

import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileDealsClient } from "@/ui/mobile/exec/MobileDealsClient";

import { WeeklyDigestClient } from "./WeeklyDigestClient";

export const metadata: Metadata = {
  title: "Недельная сводка",
};

export default function WeeklyOperationsDigestPage() {
  return (
    <MobileShell
      mobile={<MobileDealsClient />}
      desktop={<WeeklyDigestClient />}
    />
  );
}
