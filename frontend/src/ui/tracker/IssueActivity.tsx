"use client";

import { useIssueActivity } from "@/hooks/tracker/useIssue";
import type { IssueActivity as ActivityItem } from "@/domain/tracker";

const VERB_LABELS: Record<string, string> = {
  created: "создана",
  updated: "изменена",
  commented: "оставлен комментарий",
  status_changed: "смена статуса",
  assignee_added: "добавлен исполнитель",
  assignee_removed: "удалён исполнитель",
  label_added: "добавлена метка",
  label_removed: "удалена метка",
  archived: "архивирована",
  deleted: "удалена",
  meeting_started: "запущена встреча",
  goal_linked: "связана с целью",
  goal_unlinked: "отвязана от цели",
};

function describeVerb(item: ActivityItem): string {
  const base = VERB_LABELS[item.verb] ?? item.verb;
  if (item.agentName) return `${base} · ${item.agentName}`;
  return base;
}

export function IssueActivityFeed({
  orgId,
  issueId,
}: {
  orgId: string;
  issueId: string;
}) {
  const { activity, isLoading, error } = useIssueActivity(orgId, issueId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {[...Array(3)].map((_, i) => (
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
      <div className="text-sm text-danger">
        Не удалось загрузить активность.
      </div>
    );
  }

  if (activity.length === 0) {
    return <div className="text-sm text-fg-tertiary">Активности пока нет.</div>;
  }

  return (
    <ol className="flex flex-col gap-3 text-sm">
      {activity.map((item) => (
        <li
          key={item.id}
          className="flex items-start gap-3 border-l-2 border-border-subtle pl-3"
        >
          <div className="min-w-0 flex-1">
            <div className="text-fg-primary">{describeVerb(item)}</div>
            {item.field && (
              <div className="mt-0.5 text-[11px] text-fg-tertiary">
                Поле: <span className="font-mono">{item.field}</span>
              </div>
            )}
          </div>
          <time className="shrink-0 text-[11px] text-fg-tertiary">
            {item.createdAt.toLocaleString("ru-RU", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </li>
      ))}
    </ol>
  );
}
