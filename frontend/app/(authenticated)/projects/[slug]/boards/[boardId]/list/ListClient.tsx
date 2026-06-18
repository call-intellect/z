"use client";

import { useAuth } from "@/contexts/auth-context";
import { useProjectBySlug } from "@/hooks/tracker/useProjectBySlug";
import { useIssues } from "@/hooks/tracker/useIssues";
import { IssueList } from "@/ui/tracker";

export function ListClient({
  slug,
  boardId,
}: {
  slug: string;
  boardId: string;
}) {
  const { currentOrgId } = useAuth();
  const { project, isLoading: projectLoading } = useProjectBySlug(
    currentOrgId,
    slug,
  );
  const { issues, isLoading, error } = useIssues(currentOrgId, project?.id, {
    limit: 100,
    boardId,
  });

  if (projectLoading || isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-md border border-border-subtle bg-bg-elevated"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
        Не удалось загрузить задачи.
      </div>
    );
  }

  if (!project) {
    return <div className="text-sm text-fg-tertiary">Проект не найден.</div>;
  }

  return (
    <IssueList issues={issues} group emptyText="На этой доске пока нет задач" />
  );
}
