import type { Metadata } from "next";

import { PersonAppointmentsClient } from "./PersonAppointmentsClient";

export const metadata: Metadata = {
  title: "История назначений",
};

export default async function PersonAppointmentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonAppointmentsClient entityId={id} />;
}
