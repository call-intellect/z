"use client";

import Link from "next/link";
import { cn } from "@/ui/shadcn/lib/utils";
import { dueDateLabel, type Issue } from "@/domain/tracker";
import { pluralRu } from "@/domain/contribution";
import { IssuePriorityIcon } from "./IssuePriorityIcon";
import { AssigneeAvatarGroup } from "./AssigneeAvatar";

export function IssueCard({
  issue,
  className,
  compact = false,
}: {
  issue: Issue;
  className?: string;
  compact?: boolean;
}) {
  const due = dueDateLabel(issue.dueDate);

  return (
    <Link
      href={`/issues/${encodeURIComponent(issue.id)}`}
      className={cn(
        "group block rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 transition-colors",
        "hover:border-border hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        issue.isCompleted && "opacity-70",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <IssuePriorityIcon priority={issue.priority} />
        <span className="font-mono text-[11px] text-fg-tertiary shrink-0">
          {issue.identifier}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm text-fg-primary",
            issue.isCompleted && "line-through text-fg-secondary",
          )}
        >
          {issue.title}
        </span>
        <AssigneeAvatarGroup
          userIds={issue.assigneeUserIds}
          max={2}
          size={20}
        />
      </div>

      {!compact && (
        <div className="mt-1 flex items-center gap-3 text-[11px] text-fg-tertiary">
          {due && (
            <span
              className={cn(
                "truncate",
                issue.isOverdue ? "text-danger" : undefined,
              )}
            >
              {due}
            </span>
          )}
          {issue.estimatePoints !== null && (
            <span title="Оценка сложности">{issue.estimatePoints} ед.</span>
          )}
          {issue.labelIds.length > 0 && (
            <span title="Меток">
              {pluralRu(issue.labelIds.length, "метка", "метки", "меток")}
            </span>
          )}
          {issue.linkedMeetingIds.length > 0 && (
            <span title="Связанные встречи">
              {pluralRu(
                issue.linkedMeetingIds.length,
                "встреча",
                "встречи",
                "встреч",
              )}
            </span>
          )}
          {}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {issue.checklistTotalCount > 0 && (
              <ChecklistBadge
                total={issue.checklistTotalCount}
                done={issue.checklistDoneCount}
              />
            )}
            <SubtaskBadge issue={issue} />
          </span>
        </div>
      )}
    </Link>
  );
}

function SubtaskBadge({ issue }: { issue: Issue }) {
  const count = issue.childrenCount;
  if (count === null || count === 0) return null;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded bg-bg-overlay px-1.5 py-0.5 text-[10px] text-fg-secondary"
      title="Подзадач"
    >
      <span aria-hidden="true">✓</span>
      <span>{count}</span>
    </span>
  );
}

function ChecklistBadge({ total, done }: { total: number; done: number }) {
  const fully = total > 0 && total === done;
  return (
    <span
      title={`Чек-лист: ${done} из ${total}`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-medium",
        fully
          ? "bg-success/15 text-success"
          : "bg-bg-overlay text-fg-secondary",
      )}
    >
      <span aria-hidden="true">☑</span>
      <span>
        {done}/{total}
      </span>
    </span>
  );
}
