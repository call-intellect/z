'use client';

/**
 * BoardClient — клиент-обёртка над `<Board>` для маршрута
 * `/projects/[slug]/boards/[boardId]/board` (Tracker Boards, 2026-05-27).
 *
 * Отличие от legacy `[slug]/board/BoardClient` — принимает явный `boardId`
 * из URL и пробрасывает в `<Board>`. Sidebar со списком досок рендерится
 * на уровне layout (ProjectViewShell), а не здесь.
 */

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { Board } from '@/ui/tracker';

export function BoardClient({
  slug,
  boardId,
}: {
  slug: string;
  boardId: string;
}) {
  const { currentOrgId } = useAuth();
  const { project, isLoading } = useProjectBySlug(currentOrgId, slug);

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-64 w-72 shrink-0 animate-pulse rounded-lg bg-bg-overlay/40 md:w-80"
          />
        ))}
      </div>
    );
  }

  if (!currentOrgId || !project) {
    return (
      <div className="rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-10 text-center text-sm text-fg-tertiary">
        Проект не найден.
      </div>
    );
  }

  return (
    <Board orgId={currentOrgId} projectId={project.id} boardId={boardId} />
  );
}
