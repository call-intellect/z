import type { Metadata } from "next";

import { CloneDetailClient } from "./CloneDetailClient";

export const metadata: Metadata = {
  title: "Клон должности",
};

export default async function CloneDetailPage({
  params,
}: {
  params: Promise<{ roleId: string }>;
}) {
  const { roleId } = await params;
  return <CloneDetailClient roleId={roleId} />;
}
