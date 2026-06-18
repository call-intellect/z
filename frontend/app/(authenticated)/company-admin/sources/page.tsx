import type { Metadata } from "next";

import { SourcesClient } from "./SourcesClient";

export const metadata: Metadata = {
  title: "Источники",
};

export default function CompanyAdminSourcesPage() {
  return <SourcesClient />;
}
