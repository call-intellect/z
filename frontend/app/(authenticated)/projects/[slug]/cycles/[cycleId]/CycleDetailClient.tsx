'use client';

import { useAuth } from '@/contexts/auth-context';
import { useCycle, useCycleIssues } from '@/hooks/tracker/useCycle';
import { useRegisterBreadcrumb } from '@/ui/components/breadcrumbs/BreadcrumbContext';
import { CycleProgress, IssueList } from '@/ui/tracker';

export function CycleDetailClient({ cycleId }: { cycleId: string }) {
  const { currentOrgId } = useAuth();
  const { cycle, isLoading } = useCycle(currentOrgId, cycleId);
  const { issues, isLoading: issuesLoading } = useCycleIssues(
    currentOrgId,
    cycleId,
  );

  // Хлебные крошки: имя спринта из уже загруженного объекта (без доп. запроса).
  useRegisterBreadcrumb(cycle ? { label: cycle.name } : null);

  if (isLoading) {
    return (
      <div className="h-24 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
    );
  }

  if (!cycle) {
    return <div className="text-sm text-fg-tertiary">Спринт не найден.</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <CycleProgress cycle={cycle} />
      {issuesLoading ? (
        <div className="text-sm text-fg-tertiary">Загружаем задачи…</div>
      ) : (
        <IssueList issues={issues} group emptyText="В этом спринте задач нет" />
      )}
    </div>
  );
}
