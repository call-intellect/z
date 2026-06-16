import type { Metadata } from "next";

import { ExperimentDetailClient } from "./ExperimentDetailClient";

export const metadata: Metadata = {
  title: "Эксперимент",
};

export default async function ExperimentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ExperimentDetailClient id={id} />;
}
