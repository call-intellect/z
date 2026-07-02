import type { Metadata } from "next";

import { WeekDesktopClient } from "./WeekDesktopClient";

export const metadata: Metadata = {
  title: "Неделя",
};

export default function WeekPage() {
  return <WeekDesktopClient />;
}
