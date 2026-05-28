'use client';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useProjectOverview } from '@/hooks/tracker/useProjectOverview';
import {
  ActiveCycleWidget,
  ActivityFeedWidget,
  LinkedGoalsWidget,
  MetricsRow,
  OverviewSkeleton,
  ProjectHeader,
  RecentDocumentsWidget,
  StatesDistributionWidget,
} from '@/ui/tracker/overview';

/**
 * Tracker Project Overview (2026-05-27) — клиентский контейнер вкладки.
 *
 * Один SWR-запрос `/api/v1/projects/:projectId/overview` приносит все 7
 * виджетов. UX-состояния: loading (skeleton), error, empty (внутри виджетов).
 */
export function OverviewClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project, isLoading: isProjectLoading } = useProjectBySlug(
    currentOrgId,
    slug,
  );
  const projectId = project?.id ?? null;

  const { overview, isLoading, error } = useProjectOverview(
    currentOrgId,
    projectId,
  );

  if (isProjectLoading || (projectId && isLoading && !overview)) {
    return <OverviewSkeleton />;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-chip-danger-bg bg-chip-danger-bg/20 p-4 text-sm text-chip-danger-fg">
        Не удалось загрузить обзор проекта. Попробуйте обновить страницу.
      </div>
    );
  }

  if (!overview) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 text-sm text-fg-tertiary">
        Проект не найден или у вас нет доступа.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ProjectHeader
        project={overview.project}
        members={overview.members}
      />
      <MetricsRow metrics={overview.metrics} />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ActiveCycleWidget
          projectSlug={overview.project.slug}
          cycle={overview.activeCycle}
        />
        <StatesDistributionWidget buckets={overview.statesDistribution} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <ActivityFeedWidget
          projectSlug={overview.project.slug}
          items={overview.recentActivity}
        />
        <LinkedGoalsWidget goals={overview.linkedGoals} />
      </div>

      <RecentDocumentsWidget documents={overview.recentDocuments} />
    </div>
  );
}
