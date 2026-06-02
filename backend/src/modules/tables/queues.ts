import type { JobsOptions } from 'bullmq';

/**
 * Очереди Smart-таблиц. Пока единственная — `tables.sync` (live entitySync,
 * Фаза 2): job на каждое событие графа (entity.created/updated/archived) и на
 * фоновые батчи initial-backfill для больших Org.
 */
export const TABLES_QUEUE_NAMES = {
  SYNC: 'tables.sync',
  /** Smart-tables auto-creation Фаза 3 — Event-to-Cells (enrich по встрече). */
  ENRICH: 'tables.enrich',
} as const;

export type TablesQueueName =
  (typeof TABLES_QUEUE_NAMES)[keyof typeof TABLES_QUEUE_NAMES];

/**
 * Тип job'а в `tables.sync`:
 *   - `entity-event` — реакция на событие графа (created/updated/archived);
 *   - `backfill-batch` — фоновый батч initial-backfill (для Org > порога).
 */
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
  /** Список Entity.id для синхронной обработки в этом батче. */
  entityIds: string[];
}

export type TableSyncJobData =
  | TableSyncEntityJobData
  | TableSyncBackfillBatchJobData;

/**
 * Job очереди `tables.enrich` (Smart-tables Фаза 3 — Event-to-Cells).
 * Ставится после `meeting.ai_ready`: агент читает транскрипт встречи и
 * патчит ПУСТЫЕ ячейки sync-таблиц фактами по схемам колонок.
 */
export interface TableEnrichJobData {
  meetingId: string;
  tenantId: string;
}

/**
 * Опции job'ов очереди `tables.enrich`. Enrich идемпотентен (кэш по
 * TableCellProvenance(tableRowId, propertyId, sourceId)), поэтому 3 попытки
 * безопасны; дольше держим в Redis для дедупа по jobId.
 */
export const TABLE_ENRICH_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

/**
 * Дефолтные опции job'ов очереди `tables.sync`. Синк идемпотентен (upsert по
 * (tableId, entityId)), поэтому 3 попытки достаточно.
 */
export const TABLE_SYNC_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};
