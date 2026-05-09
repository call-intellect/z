import type { JobsOptions } from 'bullmq';

export const EXPORT_QUEUE = 'export';

export interface ExportJobData {
  exportId: string;
}

export const EXPORT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86400, count: 200 },
  removeOnFail: { age: 86400, count: 500 },
};
