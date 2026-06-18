import type { Metadata } from "next";
import type { ReactElement } from "react";

import { OrchestratorRunClient } from "./OrchestratorRunClient";

export const metadata: Metadata = {
  title: "Orchestrator — research run",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function OrchestratorRunPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <OrchestratorRunClient runId={id} />;
}
