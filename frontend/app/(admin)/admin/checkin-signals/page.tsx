import type { Metadata } from "next";

import { DaySignalsSettingsClient } from "./DaySignalsSettingsClient";

export const metadata: Metadata = {
  title: "Фиксатор чек-инов",
};

export default function AdminCheckinSignalsPage() {
  return <DaySignalsSettingsClient />;
}
