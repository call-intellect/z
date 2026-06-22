export type IssuePriority = "urgent" | "high" | "medium" | "low" | "none";

export const ISSUE_PRIORITY_VALUES: readonly IssuePriority[] = [
  "urgent",
  "high",
  "medium",
  "low",
  "none",
] as const;

export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = {
  urgent: "Срочно",
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
  none: "Без приоритета",
};

const KNOWN_PRIORITIES = new Set(ISSUE_PRIORITY_VALUES);

export function parseIssuePriority(
  raw: string | null | undefined,
): IssuePriority {
  if (!raw) return "none";
  return KNOWN_PRIORITIES.has(raw as IssuePriority)
    ? (raw as IssuePriority)
    : "none";
}

export type IssueStateCategory =
  | "backlog"
  | "unstarted"
  | "started"
  | "completed"
  | "cancelled";

export const ISSUE_STATE_CATEGORY_VALUES: readonly IssueStateCategory[] = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
] as const;

export const ISSUE_STATE_CATEGORY_LABELS: Record<IssueStateCategory, string> = {
  backlog: "Бэклог",
  unstarted: "К работе",
  started: "В работе",
  completed: "Готово",
  cancelled: "Отменено",
};

const KNOWN_STATE_CATEGORIES = new Set(ISSUE_STATE_CATEGORY_VALUES);

export function parseIssueStateCategory(
  raw: string | null | undefined,
): IssueStateCategory {
  if (!raw) return "backlog";
  return KNOWN_STATE_CATEGORIES.has(raw as IssueStateCategory)
    ? (raw as IssueStateCategory)
    : "backlog";
}

export type IntakeSource =
  | "in_app"
  | "email"
  | "telegram"
  | "checkin"
  | "meeting"
  | "api"
  | "concierge"
  | "chatbox";

export const INTAKE_SOURCE_LABELS: Record<IntakeSource, string> = {
  in_app: "В приложении",
  email: "Email",
  telegram: "Telegram",
  checkin: "Чек-ин",
  meeting: "Встреча",
  api: "API",
  concierge: "Помощник",
  chatbox: "Из чата",
};

export type IntakeStatus =
  | "pending"
  | "snoozed"
  | "accepted"
  | "rejected"
  | "duplicate";

export const INTAKE_STATUS_LABELS: Record<IntakeStatus, string> = {
  pending: "Ожидает триажа",
  snoozed: "Отложено",
  accepted: "Принято",
  rejected: "Отклонено",
  duplicate: "Дубликат",
};

export type TriageDecision = "accept" | "reject" | "snooze" | "duplicate";

export type IssueRelationType =
  | "blocks"
  | "blocked_by"
  | "duplicates"
  | "duplicated_by"
  | "relates_to";

export const ISSUE_RELATION_TYPE_LABELS: Record<IssueRelationType, string> = {
  blocks: "Блокирует",
  blocked_by: "Заблокирована",
  duplicates: "Дублирует",
  duplicated_by: "Дублируется",
  relates_to: "Связана",
};

export type WebhookEvent =
  | "issue.created"
  | "issue.updated"
  | "issue.deleted"
  | "comment.created"
  | "comment.updated"
  | "cycle.created"
  | "cycle.completed"
  | "project.created"
  | "project.archived"
  | "intake.created"
  | "intake.triaged";

export const WEBHOOK_EVENT_VALUES: readonly WebhookEvent[] = [
  "issue.created",
  "issue.updated",
  "issue.deleted",
  "comment.created",
  "comment.updated",
  "cycle.created",
  "cycle.completed",
  "project.created",
  "project.archived",
  "intake.created",
  "intake.triaged",
] as const;

export type ProjectMemberRole = 5 | 15 | 20;

export const PROJECT_MEMBER_ROLE_LABELS: Record<ProjectMemberRole, string> = {
  5: "Наблюдатель",
  15: "Участник",
  20: "Администратор",
};
