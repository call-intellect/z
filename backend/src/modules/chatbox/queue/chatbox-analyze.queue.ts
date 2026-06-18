import type { JobsOptions } from 'bullmq';

export const CHATBOX_ANALYZE_QUEUE = 'chatbox.analyze';

export interface ChatboxAnalyzeJobData {
  tenantId: string;
  sessionId: string;
}

export const CHATBOX_ANALYZE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400, count: 1000 },
};
