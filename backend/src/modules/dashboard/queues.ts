import type { JobsOptions } from 'bullmq';

export const DASHBOARD_QUEUE_NAMES = {
  MEETING_ROI: 'dashboard.meeting-roi',
  DECISION_HYGIENE: 'dashboard.decision-hygiene',
} as const;

export type DashboardQueueName = (typeof DASHBOARD_QUEUE_NAMES)[keyof typeof DASHBOARD_QUEUE_NAMES];

export const MEETING_ROI_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: false,
};

export const DECISION_HYGIENE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: false,
};

export interface MeetingRoiJobData {
  meetingId: string;
}

export interface DecisionHygieneJobData {
  decisionId: string;
  tenantId: string;
}
