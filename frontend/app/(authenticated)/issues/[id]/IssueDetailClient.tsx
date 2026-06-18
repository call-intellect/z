"use client";

import { useAuth } from "@/contexts/auth-context";
import { useIssue } from "@/hooks/tracker/useIssue";
import { useRegisterBreadcrumb } from "@/ui/components/breadcrumbs/BreadcrumbContext";
import {
  IssueActivityFeed,
  IssueAttachments,
  IssueBreadcrumb,
  IssueChat,
  IssueChecklists,
  IssueComments,
  IssueDescription,
  IssueHeader,
  IssueRelations,
  IssueSidebar,
  IssueSimilar,
  IssueSubtasks,
} from "@/ui/tracker";

export function IssueDetailClient({ issueId }: { issueId: string }) {
  const { currentOrgId, user } = useAuth();
  const { issue, isLoading, error, mutate } = useIssue(currentOrgId, issueId);

  useRegisterBreadcrumb(issue ? { label: issue.title } : null);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-3 p-4 md:p-6">
        <div className="h-7 w-72 animate-pulse rounded bg-bg-overlay" />
        <div className="h-32 animate-pulse rounded-md border border-border-subtle bg-bg-elevated" />
      </div>
    );
  }

  if (error || !currentOrgId) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="rounded-md border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
          Не удалось загрузить задачу.
        </div>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="text-sm text-fg-tertiary">Задача не найдена.</div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      {}
      {issue.parentId ? (
        <IssueBreadcrumb
          orgId={currentOrgId}
          parentIssueId={issue.parentId}
          currentIssue={issue}
        />
      ) : null}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <IssueHeader issue={issue} orgId={currentOrgId} onUpdated={mutate} />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Описание</h2>
            <IssueDescription description={issue.description} />
          </section>

          {}
          <IssueSubtasks
            issue={issue}
            orgId={currentOrgId}
            currentUserId={user?.id ?? null}
          />

          {}
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Чек-листы</h2>
            <IssueChecklists orgId={currentOrgId} issueId={issue.id} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Связи</h2>
            <IssueRelations orgId={currentOrgId} issueId={issue.id} />
          </section>

          {}
          <IssueSimilar orgId={currentOrgId} issueId={issue.id} />

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Файлы</h2>
            <IssueAttachments
              orgId={currentOrgId}
              issueId={issue.id}
              onUploaded={mutate}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Чат</h2>
            <IssueChat issueId={issue.id} orgId={currentOrgId} />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Комментарии</h2>
            <IssueComments
              orgId={currentOrgId}
              issueId={issue.id}
              projectId={issue.projectId}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-fg-primary">Активность</h2>
            <IssueActivityFeed orgId={currentOrgId} issueId={issue.id} />
          </section>
        </div>

        <div>
          {}
          <IssueSidebar issue={issue} orgId={currentOrgId} onMoved={mutate} />
        </div>
      </div>
    </div>
  );
}
