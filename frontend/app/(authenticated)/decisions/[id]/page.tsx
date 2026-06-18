import type { Metadata } from "next";

import { MobileShell } from "@/ui/mobile/MobileShell";
import { MobileMemoryClient } from "@/ui/mobile/manager/MobileMemoryClient";

import { DecisionsListClient } from "../DecisionsListClient";

export const metadata: Metadata = { title: "Решение" };

export default async function DecisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <MobileShell
      mobile={<MobileMemoryClient />}
      desktop={<DecisionsListClient initialSelectedId={id} />}
    />
  );
}
