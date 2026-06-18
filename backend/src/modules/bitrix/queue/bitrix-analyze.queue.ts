import type { JobsOptions } from 'bullmq';

export const BITRIX_ANALYZE_QUEUE = 'bitrix.analyze';

export interface BitrixAnalyzeJobData {
  tenantId: string;
  sessionId: string;
}

export const BITRIX_ANALYZE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400, count: 1000 },
};
