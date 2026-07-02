import type { Metadata } from "next";

import { WeeklyDigestClient } from "./WeeklyDigestClient";

export const metadata: Metadata = {
  title: "Недельная сводка",
};

export default function WeeklyOperationsDigestPage() {
  return <WeeklyDigestClient />;
}
