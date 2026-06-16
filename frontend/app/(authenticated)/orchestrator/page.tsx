import type { Metadata } from "next";
import type { ReactElement } from "react";

import { OrchestratorRequestClient } from "./OrchestratorRequestClient";

export const metadata: Metadata = {
  title: "Orchestrator — глубокий research",
};

export default function OrchestratorPage(): ReactElement {
  return <OrchestratorRequestClient />;
}
