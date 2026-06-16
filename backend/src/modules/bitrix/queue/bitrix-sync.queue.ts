import type { JobsOptions } from 'bullmq';

/** Имя очереди синка Bitrix24 (отдельный домен, без `ai.`-префикса). */
export const BITRIX_SYNC_QUEUE = 'bitrix.sync';

export type BitrixSyncScope = 'all' | 'users' | 'dialogs' | 'crm';

export interface BitrixSyncJobData {
  tenantId: string;
  scope: BitrixSyncScope;
}

export const BITRIX_SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 86400, count: 500 },
};
