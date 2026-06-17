import type { Metadata } from "next";

import { TeamDetailClient } from "./TeamDetailClient";

export const metadata: Metadata = {
  title: "Команда",
};

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TeamDetailClient departmentId={id} />;
}
