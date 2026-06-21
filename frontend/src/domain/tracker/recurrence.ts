export type IssuePriorityValue =
  | "urgent"
  | "high"
  | "medium"
  | "low"
  | "none";

export interface IssueTemplateChecklist {
  title?: string;
  items: { text: string }[];
}

export interface IssueTemplateConfig {
  title: string;
  description?: string | null;
  priority?: IssuePriorityValue;
  estimatePoints?: number | null;
  checklist?: IssueTemplateChecklist[];
  labelIds?: string[];
  assigneeUserIds?: string[];
  assigneeRole?: string;
}

export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface RecurrenceRule {
  freq: RecurrenceFrequency;
  interval: number;
  byweekday?: number[];
}

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> =
  {
    daily: "Ежедневно",
    weekly: "Еженедельно",
    monthly: "Ежемесячно",
  };

export interface IssueTemplateApi {
  id: string;
  projectId: string | null;
  name: string;
  config: IssueTemplateConfig;
  createdById: string;
  createdAt: string;
}

export interface IssueTemplate {
  id: string;
  projectId: string | null;
  name: string;
  config: IssueTemplateConfig;
  createdById: string;
  createdAt: Date;
}

export function issueTemplateFromApi(api: IssueTemplateApi): IssueTemplate {
  return {
    id: api.id,
    projectId: api.projectId,
    name: api.name,
    config: api.config,
    createdById: api.createdById,
    createdAt: new Date(api.createdAt),
  };
}

export interface IssueRecurrenceApi {
  id: string;
  projectId: string;
  templateIssueId: string | null;
  rule: RecurrenceRule;
  config: IssueTemplateConfig;
  nextRunAt: string;
  lastRunAt: string | null;
  enabled: boolean;
  createdById: string;
  createdAt: string;
}

export interface IssueRecurrence {
  id: string;
  projectId: string;
  templateIssueId: string | null;
  rule: RecurrenceRule;
  config: IssueTemplateConfig;
  nextRunAt: Date;
  lastRunAt: Date | null;
  enabled: boolean;
  createdById: string;
  createdAt: Date;
}

export function issueRecurrenceFromApi(
  api: IssueRecurrenceApi,
): IssueRecurrence {
  return {
    id: api.id,
    projectId: api.projectId,
    templateIssueId: api.templateIssueId,
    rule: api.rule,
    config: api.config,
    nextRunAt: new Date(api.nextRunAt),
    lastRunAt: api.lastRunAt ? new Date(api.lastRunAt) : null,
    enabled: api.enabled,
    createdById: api.createdById,
    createdAt: new Date(api.createdAt),
  };
}
