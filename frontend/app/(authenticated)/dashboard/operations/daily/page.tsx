import type { Metadata } from "next";

import { DailyDigestClient } from "./DailyDigestClient";

export const metadata: Metadata = {
  title: "Ежедневный отчёт",
};

export default function DailyOperationsDigestPage() {
  return <DailyDigestClient />;
}
