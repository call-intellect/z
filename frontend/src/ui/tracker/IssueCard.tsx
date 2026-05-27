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
          {/* Badge-зона в правом нижнем углу карточки.
              flex-1 spacer + badges. Если рядом будет badge от чек-листов
              (другое ТЗ tracker-checklists, символ ☑) — он встанет слева
              от нашего. Не имитируем чек-листы здесь — только подзадачи. */}
          <span className="ml-auto inline-flex items-center gap-1.5">
            <SubtaskBadge issue={issue} />
          </span>
        </div>
      )}
    </Link>
  );
}

/**
 * Tracker subtasks UI (2026-05-27) — badge «✓ N/M» в карточке задачи.
 *
 * Виден только если backend вернул `childrenCount > 0`. Цвет:
 *   - mint (`text-accent`) — есть выполненные подзадачи (`isCompleted`
 *     родителя НЕ учитываем — счётчик считаем только по детям).
 *     На текущем уровне без отдельного запроса `getChildren` мы не знаем
 *     completed-долю, поэтому показываем символ ✓ + общее число.
 *     Полный вид `N/M` появится, когда backend начнёт возвращать
 *     `completedChildrenCount` (отдельное расширение API в будущем).
 *   - серый — иначе.
 *
 * NB: NotaBene. На MVP отдельно `completedCount` не запрашиваем — добавим
 * вторую цифру, когда у DTO появится `completedChildrenCount`. ТЗ требует
 * именно badge с указанием прогресса; здесь ограничиваемся `✓ N`.
 */
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
