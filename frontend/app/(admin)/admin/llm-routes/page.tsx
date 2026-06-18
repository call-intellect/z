import type { Metadata } from "next";

import { LlmRoutesClient } from "./LlmRoutesClient";

export const metadata: Metadata = {
  title: "Управление роутами LLM",
};

export default function AdminLlmRoutesPage() {
  return <LlmRoutesClient />;
}
