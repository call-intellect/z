import type { JobsOptions } from 'bullmq';

/** Имя очереди синка ChatBox. Не префиксуем `ai.` — отдельный домен. */
export const CHATBOX_SYNC_QUEUE = 'chatbox.sync';

export type ChatboxSyncScope =
  | 'all'
  | 'customers'
  | 'managers'
  | 'chats'
  | 'incremental';

export interface ChatboxSyncJobData {
  tenantId: string;
  scope: ChatboxSyncScope;
  /** Бэкафилл: тянуть чаты не старше этой даты (ISO). Только для scope chats/all. */
  since?: string;
}

export const CHATBOX_SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 86400, count: 500 },
};
