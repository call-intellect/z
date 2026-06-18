import type { Metadata } from "next";

import { RoutingDetailClient } from "./RoutingDetailClient";

export const metadata: Metadata = {
  title: "Модель агента",
};

export default async function AdminAiRoutingDetailPage({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  return <RoutingDetailClient taskType={decodeURIComponent(taskType)} />;
}
