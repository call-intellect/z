import type { JobsOptions } from 'bullmq';

export const TABLES_QUEUE_NAMES = {
  SYNC: 'tables.sync',
  ENRICH: 'tables.enrich',
} as const;

export type TableSyncEventType = 'created' | 'updated' | 'archived';

export interface TableSyncEntityJobData {
  kind: 'entity-event';
  tenantId: string;
  entityId: string;
  entityType: string;
  eventType: TableSyncEventType;
}

export interface TableSyncBackfillBatchJobData {
  kind: 'backfill-batch';
  tenantId: string;
  tableId: string;
  entityIds: string[];
}

export type TableSyncJobData = TableSyncEntityJobData | TableSyncBackfillBatchJobData;

export interface TableEnrichJobData {
  meetingId: string;
  tenantId: string;
}

export const TABLE_ENRICH_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

export const TABLE_SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};
