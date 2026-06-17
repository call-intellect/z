import { Suspense } from "react";

import { ConsumeMagicLinkClient } from "./ConsumeMagicLinkClient";

export const dynamic = "force-dynamic";

export default function ConsumeMagicLinkPage() {
  return (
    <Suspense fallback={null}>
      <ConsumeMagicLinkClient />
    </Suspense>
  );
}
