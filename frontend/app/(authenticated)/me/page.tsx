import type { Metadata } from "next";
import { Suspense } from "react";

import { MeTabsClient } from "./MeTabsClient";

export const metadata: Metadata = {
  title: "Я",
};

export default function MePage() {
  return (
    <Suspense fallback={null}>
      <MeTabsClient />
    </Suspense>
  );
}
