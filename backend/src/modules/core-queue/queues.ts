import type { JobsOptions } from 'bullmq';

/**
 * Имена BullMQ-очередей для knowledge-core (knowledge core = единое
 * информационное ядро). Префикс `core.` отделяет от `ai.*` очередей
 * AI-pipeline.
 *
 * Состав по фазам:
 *   - `core.raw-events`     (Фаза 1) — публикуется `IngestService`. Consumer:
 *      `block-ingest.worker` (Фаза 2). Payload: `{ rawEventId }`.
 *   - `core.block-distill`  (Фаза 2) — после block-ingest. Consumer:
 *      `block-distill.worker`. Payload: `{ blockId }`. Дебаунс 30s,
 *      jobId = `block_distill_<blockId>` (повторный enqueue обновляет delay).
 *   - `core.block-linker`   (Фаза 3) — после distill для canonical-блоков.
 *      На Фазе 2 jobs накапливаются — это нормально.
 *   - `core.entity-resolver` (Фаза 4) — арбитраж дублей Entity. На Фазе 2
 *      jobs не публикуются — очередь существует только для предсоздания.
 *   - `core.theme-clusterer` (Фаза 4) — кластеризация тем. Аналогично — pending.
 */
export const CORE_QUEUE_NAMES = {
  /** Универсальная очередь raw events для ingest pipeline. */
  RAW_EVENTS: 'core.raw-events',
  /** После создания IdeaBlock — дистилляция (KNN + LLM-арбитр merge/distinct). */
  BLOCK_DISTILL: 'core.block-distill',
  /** После канонизации блока — пересчёт связей (Фаза 3). */
  BLOCK_LINKER: 'core.block-linker',
  /** Дедупликация Entity (Фаза 4). */
  ENTITY_RESOLVER: 'core.entity-resolver',
  /** Кластеризация тем (Фаза 4). */
  THEME_CLUSTERER: 'core.theme-clusterer',
  /**
   * Card-rollup-v2 (Фаза 4): пересборка `Card.summaryCache` поверх IdeaBlock'ов
   * (через meeting и через entityId). Дебаунс ~60s по jobId=`card_rollup_v2_<cardId>`.
   */
  CARD_ROLLUP_V2: 'core.card-rollup-v2',
} as const;

export type CoreQueueName = (typeof CORE_QUEUE_NAMES)[keyof typeof CORE_QUEUE_NAMES];

/**
 * Дефолтные опции job'ов knowledge-core. Те же 5 attempts, что и у
 * AI-pipeline, но backoff меньше (5s вместо 8s) — события raw-events
 * легковесные (только `rawEventId`), не нужно долгое ожидание между retry.
 *
 *   attempts: 5                               — итого до 5 попыток.
 *   backoff: exponential delay 5000           — 5s, 10s, 20s, 40s.
 *   removeOnComplete: { age: 24h, count:1000} — успешные jobs не висят.
 *   removeOnFail: false                       — failed остаются для разбора.
 */
export const CORE_DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

/**
 * Payload для job'а `core.raw-events`. Минимальный — только `rawEventId`,
 * остальное consumer (block-ingest.worker, Фаза 2) подтянет из БД.
 */
export interface RawEventJobData {
  rawEventId: string;
}

/** Payload для job'а `core.block-distill`. */
export interface BlockDistillJobData {
  blockId: string;
}

/** Payload для job'а `core.block-linker`. */
export interface BlockLinkerJobData {
  blockId: string;
}

/** Payload для job'а `core.entity-resolver`. */
export interface EntityResolverJobData {
  entityId: string;
}

/** Payload для job'а `core.card-rollup-v2`. Дополнительно reason — для логов. */
export interface CardRollupV2JobData {
  cardId: string;
  reason?: string;
}
