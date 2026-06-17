import type { Metadata } from "next";

import { PersonKnowledgeProfileClient } from "./PersonKnowledgeProfileClient";

export const metadata: Metadata = {
  title: "Профиль знаний",
};

export default async function PersonKnowledgeProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PersonKnowledgeProfileClient personId={id} />;
}
