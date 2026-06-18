import type { Metadata } from "next";

import { EntityGraphClient } from "./EntityGraphClient";

export const metadata: Metadata = {
  title: "Карта знаний — что система знает про сущность",
};

export default async function EntityGraphPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EntityGraphClient entityId={id} />;
}
