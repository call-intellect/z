'use client';

import {
  Calendar,
  Flag,
  Tag,
  Target,
  Users,
  Layers,
} from 'lucide-react';
import {
  ISSUE_PRIORITY_LABELS,
  dueDateLabel,
  type Issue,
} from '@/domain/tracker';
import { IssuePriorityIcon } from './IssuePriorityIcon';
import { AssigneeAvatarGroup } from './AssigneeAvatar';
import { StartMeetingButton } from './StartMeetingButton';

/**
 * IssueSidebar — правая колонка карточки задачи: исполнители, приоритет,
 * метки, цикл, цель, сроки + кнопка «Запустить встречу».
 */
export function IssueSidebar({
  issue,
  orgId,
}: {
  issue: Issue;
  orgId: string;
}) {
  const due = dueDateLabel(issue.dueDate);

  return (
    <aside className="flex flex-col gap-3 rounded-md border border-border-subtle bg-bg-elevated p-4 text-sm">
      <Row icon={<Users size={14} />} label="Исполнители">
        <AssigneeAvatarGroup userIds={issue.assigneeUserIds} max={6} size={22} />
      </Row>

      <Row icon={<IssuePriorityIcon priority={issue.priority} />} label="Приоритет">
        <span className="text-fg-primary">
          {ISSUE_PRIORITY_LABELS[issue.priority]}
        </span>
      </Row>

      <Row icon={<Flag size={14} />} label="Срок">
        <span className={due && issue.isOverdue ? 'text-danger' : 'text-fg-primary'}>
          {due ?? '—'}
        </span>
      </Row>

      <Row icon={<Tag size={14} />} label="Метки">
        <span className="text-fg-primary">
          {issue.labelIds.length > 0 ? `${issue.labelIds.length} меток` : '—'}
        </span>
      </Row>

      <Row icon={<Layers size={14} />} label="Цикл">
        <span className="text-fg-primary">{issue.cycleId ?? '—'}</span>
      </Row>

      <Row icon={<Target size={14} />} label="Цель">
        <span className="text-fg-primary">{issue.goalId ?? '—'}</span>
      </Row>

      <Row icon={<Calendar size={14} />} label="Создана">
        <span className="text-fg-secondary text-xs">
          {issue.createdAt.toLocaleDateString('ru-RU')}
        </span>
      </Row>

      <div className="mt-2 border-t border-border-subtle pt-3">
        <StartMeetingButton orgId={orgId} issueId={issue.id} />
      </div>
    </aside>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-fg-tertiary">{icon}</span>
      <span className="w-24 shrink-0 text-xs uppercase tracking-wider text-fg-tertiary">
        {label}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
