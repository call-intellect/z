import type { Metadata } from "next";

import { DestinationsClient } from "../settings/integrations/DestinationsClient";

export const metadata: Metadata = {
  title: "Доставка",
};

export default function DeliveryPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <DestinationsClient />
    </div>
  );
}
