import type { Metadata } from "next";

import { ProjectViewShell } from "../../../ProjectViewShell";

import { BoardClient } from "./BoardClient";

export const metadata: Metadata = {
  title: "Доска",
};

export default async function ProjectBoardPage({
  params,
}: {
  params: Promise<{ slug: string; boardId: string }>;
}) {
  const { slug, boardId } = await params;
  return (
    <ProjectViewShell slug={slug}>
      <BoardClient slug={slug} boardId={boardId} />
    </ProjectViewShell>
  );
}
