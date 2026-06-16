import type { Metadata } from "next";

import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileDealsClient } from "@/ui/mobile/exec/MobileDealsClient";

import { WeekDesktopClient } from "./WeekDesktopClient";

export const metadata: Metadata = {
  title: "Неделя",
};

export default function WeekPage() {
  return (
    <MobileShell
      mobile={<MobileDealsClient />}
      desktop={<WeekDesktopClient />}
    />
  );
}
