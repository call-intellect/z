import type { Metadata } from "next";
import { Suspense } from "react";

import { StandClient } from "./StandClient";

export const metadata: Metadata = {
  title: "Мой день",
};

export default function StandPage() {
  return (
    <Suspense fallback={null}>
      <StandClient />
    </Suspense>
  );
}
