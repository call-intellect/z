/**
 * События графа знаний, на которые подписан live entitySync Smart-таблиц
 * (Smart-tables Фаза 2 — graph-driven rows).
 *
 * Эмитятся из `EntityResolutionService` (knowledge-core) через
 * `@nestjs/event-emitter`. Слушает `TableSyncListener` (модуль tables),
 * который кладёт job в очередь `tables.sync`. Воркер `TableSyncWorker`
 * вызывает `TableSyncService.applyEntityEvent`.
 *
 * Имена — строки (не enum), чтобы совпадать со стилем billing.events /
 * idea.created и не требовать `keyof typeof`.
 */
export const ENTITY_CREATED = 'entity.created' as const;
export const ENTITY_UPDATED = 'entity.updated' as const;
export const ENTITY_ARCHIVED = 'entity.archived' as const;

export type EntitySyncEventName =
  | typeof ENTITY_CREATED
  | typeof ENTITY_UPDATED
  | typeof ENTITY_ARCHIVED;

/**
 * Payload всех трёх событий. `entityType` — строковое значение enum'а
 * `EntityType` (`customer` / `person` / `document` / …).
 */
export interface EntitySyncEventPayload {
  tenantId: string;
  entityId: string;
  entityType: string;
}

/**
 * Smart-tables auto-creation Фаза 3 — Event-to-Cells.
 *
 * Эмитится из `AnalyzeWorker` через `@nestjs/event-emitter` ПОСЛЕ успешного
 * перехода встречи в статус `ai_ready` (best-effort, не ломает AI-pipeline).
 * Слушает `TableEnrichListener` (модуль tables), который кладёт job в очередь
 * `tables.enrich`. Воркер `TableEnrichWorker` вызывает
 * `TableEnrichService.enrichFromEvent`.
 */
export const MEETING_AI_READY = 'meeting.ai_ready' as const;

export type MeetingAiReadyEventName = typeof MEETING_AI_READY;

/** Payload события `meeting.ai_ready`. `type` — значение `MeetingType`. */
export interface MeetingAiReadyEventPayload {
  meetingId: string;
  tenantId: string;
  type: string;
}
