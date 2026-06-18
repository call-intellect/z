import type { Metadata } from "next";

import { PersonPulseClient } from "./PersonPulseClient";

export const metadata: Metadata = { title: "Карточка сотрудника" };

export default async function PersonPulsePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonPulseClient personId={id} />;
}
