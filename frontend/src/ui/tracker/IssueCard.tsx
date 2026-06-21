"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Minus,
  MessageSquare,
  Paperclip,
} from "lucide-react";
import { cn } from "@/ui/shadcn/lib/utils";
import {
  dueDateLabel,
  startDateLabel,
  type Issue,
  ISSUE_PRIORITY_LABELS,
  type IssuePriority,
} from "@/domain/tracker";
import type { ProvenanceSourceType } from "@/domain/provenance";
import { ProvenancePreviewSnippet } from "@/ui/components/provenance/ProvenancePreviewSnippet";
import { AssigneeAvatarGroup } from "./AssigneeAvatar";

export function IssueCard({
  issue,
  className,
  compact = true,
}: {
  issue: Issue;
  className?: string;
  compact?: boolean;
}) {
  const due = dueDateLabel(issue.dueDate);
  const start = startDateLabel(issue.startDate);
  const source = sourceChipLabel(issue);
  const hasChecklist = issue.checklistTotalCount > 0;
  const urgency = deadlineUrgency(issue);

  return (
    <Link
      href={`/issues/${encodeURIComponent(issue.id)}`}
      className={cn(
        "group block rounded-md border border-border-subtle bg-bg-elevated px-3 py-2.5 transition-colors",
        "hover:border-border hover:bg-bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        issue.isCompleted && "opacity-70",
        className,
      )}
    >
      {/* Суть: приоритет + код + заголовок (2 строки), справа исполнители */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5">
            <PriorityChip priority={issue.priority} />
            <span className="shrink-0 font-mono text-[10px] text-fg-tertiary">
              {issue.identifier}
            </span>
          </div>
          <h3
            className={cn(
              "line-clamp-2 text-sm font-medium leading-snug text-fg-primary",
              issue.isCompleted && "font-normal text-fg-secondary line-through",
            )}
          >
            {issue.title}
          </h3>
        </div>
        <AssigneeAvatarGroup userIds={issue.assigneeUserIds} max={2} size={20} />
      </div>

      {/* Широкий вид: превью описания */}
      {!compact && issue.descriptionStripped?.trim() ? (
        <p className="mt-1.5 line-clamp-2 text-xs text-fg-secondary">
          {issue.descriptionStripped}
        </p>
      ) : null}

      {/* Прогресс-бар чек-листа */}
      {hasChecklist ? (
        <ProgressBar
          done={issue.checklistDoneCount}
          total={issue.checklistTotalCount}
          overdue={issue.isOverdue}
          className="mt-2"
        />
      ) : null}

      {/* Мета: дедлайн + старт + источник + (широкий) бейджи; справа чек-лист/подзадачи */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-tertiary">
        {due ? (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 font-medium",
              urgency === "overdue" && "bg-chip-danger-bg text-chip-danger-fg",
              urgency === "soon" && "bg-chip-warning-bg text-chip-warning-fg",
              urgency === "normal" && "text-fg-secondary",
            )}
          >
            {due}
          </span>
        ) : null}
        {start ? <span>{start}</span> : null}
        {source ? (
          <span className="inline-flex items-center rounded bg-chip-lavender-bg px-1.5 py-0.5 font-medium text-chip-lavender-fg">
            {source}
          </span>
        ) : null}
        {issue.estimatePoints !== null ? (
          <span title="Оценка сложности">{issue.estimatePoints} ед.</span>
        ) : null}
        {!compact ? <EngagementBadges issue={issue} /> : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {hasChecklist ? (
            <ChecklistBadge
              total={issue.checklistTotalCount}
              done={issue.checklistDoneCount}
            />
          ) : null}
          <SubtaskBadge issue={issue} />
        </span>
      </div>

      {/* Широкий вид: кликабельная цитата-источник (deep-link) */}
      {!compact && issue.provenancePreview ? (
        <ProvenancePreviewSnippet
          preview={issue.provenancePreview}
          className="mt-1.5"
        />
      ) : null}
    </Link>
  );
}

const PRIORITY_CHIP: Record<
  IssuePriority,
  { cls: string; Icon: typeof AlertCircle } | null
> = {
  urgent: { cls: "bg-chip-danger-bg text-chip-danger-fg", Icon: AlertCircle },
  high: { cls: "bg-chip-warning-bg text-chip-warning-fg", Icon: ArrowUp },
  medium: { cls: "bg-bg-overlay text-fg-secondary", Icon: Minus },
  low: { cls: "bg-bg-overlay text-fg-tertiary", Icon: ArrowDown },
  none: null,
};

function PriorityChip({ priority }: { priority: IssuePriority }) {
  const cfg = PRIORITY_CHIP[priority];
  if (!cfg) return null;
  const { cls, Icon } = cfg;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
        cls,
      )}
    >
      <Icon size={11} aria-hidden="true" />
      {ISSUE_PRIORITY_LABELS[priority]}
    </span>
  );
}

const SOURCE_TYPE_LABEL: Record<ProvenanceSourceType, string> = {
  meeting: "из встречи",
  document: "из документа",
  chat: "из чата",
  voice_note: "из голосового",
  email: "из письма",
  phone_call: "из звонка",
};

const EXTERNAL_SOURCE_LABEL: Record<string, string> = {
  meeting: "из встречи",
  email: "из письма",
  telegram: "из Telegram",
  checkin: "из чек-ина",
  concierge: "из помощника",
  api: "из API",
};

function sourceChipLabel(issue: Issue): string | null {
  const type = issue.provenancePreview?.source.type;
  if (type) return SOURCE_TYPE_LABEL[type];
  if (issue.externalSource && EXTERNAL_SOURCE_LABEL[issue.externalSource]) {
    return EXTERNAL_SOURCE_LABEL[issue.externalSource];
  }
  if (issue.linkedMeetingIds.length > 0) return "из встречи";
  if (issue.sourceBlockIds.length > 0) return "из памяти";
  return null;
}

function deadlineUrgency(issue: Issue): "overdue" | "soon" | "normal" {
  if (issue.isOverdue) return "overdue";
  if (issue.dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(issue.dueDate);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.round(
      (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (diffDays <= 1) return "soon";
  }
  return "normal";
}

function ProgressBar({
  done,
  total,
  overdue,
  className,
}: {
  done: number;
  total: number;
  overdue: boolean;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-overlay">
        <span
          className={cn(
            "block h-full rounded-full",
            overdue ? "bg-warning" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-fg-tertiary">
        {done}/{total}
      </span>
    </div>
  );
}

function EngagementBadges({ issue }: { issue: Issue }) {
  const comments = issue.commentCount ?? 0;
  const attachments = issue.attachmentCount ?? 0;
  if (comments === 0 && attachments === 0) return null;
  return (
    <>
      {comments > 0 ? (
        <span
          className="inline-flex items-center gap-0.5"
          title="Есть обсуждение"
        >
          <MessageSquare size={11} aria-hidden="true" />
          {comments}
        </span>
      ) : null}
      {attachments > 0 ? (
        <span className="inline-flex items-center gap-0.5" title="Есть файлы">
          <Paperclip size={11} aria-hidden="true" />
          {attachments}
        </span>
      ) : null}
    </>
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
          ? "bg-chip-success-bg text-chip-success-fg"
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
