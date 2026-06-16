import type { JobsOptions } from 'bullmq';

export const TRACKER_QUEUE_NAMES = {
  WEBHOOK_DELIVERY: 'tracker.webhook-delivery',
  ISSUE_EMBED: 'core.issue-embed',
  INTAKE_AUTO_TRIAGE: 'core.intake-auto-triage',
  IMPORT_TRACKER: 'core.imports',
} as const;

export type TrackerQueueName = (typeof TRACKER_QUEUE_NAMES)[keyof typeof TRACKER_QUEUE_NAMES];

export const WEBHOOK_DELIVERY_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400, count: 1000 },
};

export interface WebhookDeliveryJobData {
  webhookId: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  enqueuedAt: string;
}

export interface IssueEmbedJobData {
  tenantId: string;
  issueId: string;
}

export const ISSUE_EMBED_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400, count: 500 },
};

export interface IntakeAutoTriageJobData {
  tenantId: string;
  intakeIssueId: string;
}

export const INTAKE_AUTO_TRIAGE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400, count: 1000 },
};

export interface ImportTrackerJobData {
  tenantId: string;
  importLogId: string;
}

export const IMPORT_TRACKER_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 7 * 86_400, count: 200 },
  removeOnFail: { age: 30 * 86_400, count: 200 },
};
