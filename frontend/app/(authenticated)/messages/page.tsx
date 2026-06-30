import type { Metadata } from "next";
import { Suspense } from "react";

import { MessagesClient } from "@/ui/messaging/MessagesClient";

export const metadata: Metadata = {
  title: "Сообщения",
};

export default function MessagesPage() {
  return (
    <Suspense fallback={null}>
      <MessagesClient />
    </Suspense>
  );
}
