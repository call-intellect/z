import type { Metadata } from "next";

import { KnowledgeProfileClient } from "./KnowledgeProfileClient";

export const metadata: Metadata = {
  title: "Что Кора знает обо мне",
};

export default function MeKnowledgeProfilePage() {
  return <KnowledgeProfileClient />;
}
