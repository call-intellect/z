import type { Metadata } from "next";

import { CatalogClient } from "./CatalogClient";

export const metadata: Metadata = {
  title: "Каталог LLM",
};

export default function AdminAiCatalogPage() {
  return <CatalogClient />;
}
