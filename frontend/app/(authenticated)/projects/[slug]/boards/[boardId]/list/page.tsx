import type { Metadata } from "next";

import { ProjectViewShell } from "../../../ProjectViewShell";

import { ListClient } from "./ListClient";

export const metadata: Metadata = {
  title: "Список задач",
};

export default async function ProjectListPage({
  params,
}: {
  params: Promise<{ slug: string; boardId: string }>;
}) {
  const { slug, boardId } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <ListClient slug={slug} boardId={boardId} />
    </ProjectViewShell>
  );
}
