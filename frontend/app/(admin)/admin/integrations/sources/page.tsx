import type { Metadata } from "next";

import { SourcesClient } from "./SourcesClient";

export const metadata: Metadata = { title: "Состояние источников" };

export default function AdminIntegrationSourcesPage() {
  return <SourcesClient />;
}
