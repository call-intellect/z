import type { JobsOptions } from 'bullmq';

export const CHATBOX_SYNC_QUEUE = 'chatbox.sync';

export type ChatboxSyncScope = 'all' | 'customers' | 'managers' | 'chats' | 'incremental';

export interface ChatboxSyncJobData {
  tenantId: string;
  scope: ChatboxSyncScope;
  since?: string;
}

export const CHATBOX_SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 86400, count: 500 },
};
