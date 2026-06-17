import type { Metadata } from "next";

import { ConflictDetailClient } from "./ConflictDetailClient";

export const metadata: Metadata = {
  title: "Конфликт",
};

export default async function ConflictDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConflictDetailClient conflictId={id} />;
}
