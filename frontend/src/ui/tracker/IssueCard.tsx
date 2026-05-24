'use client';

/**
 * IssueCard — компактная карточка задачи для канбана и списка.
 *
 * Mobile (default): одна строка, ≤80px высота — приоритет + identifier +
 * title + assignee + срок. Тап ведёт на `/issues/:id`.
 *
 * Desktop (md+): две строки — добавляются метки и метаданные.
 */

import Link from 'next/link';
import { cn } from '@/ui/shadcn/lib/utils';
import { dueDateLabel, type Issue } from '@/domain/tracker';
import { IssuePriorityIcon } from './IssuePriorityIcon';
import { AssigneeAvatarGroup } from './AssigneeAvatar';

export function IssueCard({
  issue,
  className,
  compact = false,
}: {
  issue: Issue;
  className?: string;
  /** Компактный режим для списков / drag-n-drop placeholder. */
  compact?: boolean;
}) {
  const due = dueDateLabel(issue.dueDate);

  return (
    <Link
      href={`/issues/${encodeURIComponent(issue.id)}`}
      className={cn(
        'group block rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 transition-colors',
        'hover:border-border hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        issue.isCompleted && 'opacity-70',
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
            'min-w-0 flex-1 truncate text-sm text-fg-primary',
            issue.isCompleted && 'line-through text-fg-secondary',
          )}
        >
          {issue.title}
        </span>
        <AssigneeAvatarGroup userIds={issue.assigneeUserIds} max={2} size={20} />
      </div>

      {!compact && (
        <div className="mt-1 flex items-center gap-3 text-[11px] text-fg-tertiary">
          {due && (
            <span
              className={cn(
                'truncate',
                issue.isOverdue ? 'text-danger' : undefined,
              )}
            >
              {due}
            </span>
          )}
          {issue.estimatePoints !== null && (
            <span title="Оценка в попугаях">{issue.estimatePoints} ед.</span>
          )}
          {issue.labelIds.length > 0 && (
            <span title="Меток">{issue.labelIds.length} меток</span>
          )}
          {issue.linkedMeetingIds.length > 0 && (
            <span title="Связанные встречи">
              {issue.linkedMeetingIds.length} встреч
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
