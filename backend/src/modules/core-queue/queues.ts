import type { JobsOptions } from 'bullmq';

/**
 * Имена BullMQ-очередей для knowledge-core (knowledge core = единое
 * информационное ядро). Префикс `core.` отделяет от `ai.*` очередей
 * AI-pipeline.
 *
 * На Фазе 1 существует одна очередь:
 *   - `core.raw-events` — публикуется `IngestService` после успешного
 *     создания `RawEvent`. Consumer (`block-ingest.worker`) появится
 *     в Фазе 2; до этого jobs накапливаются в Redis (это нормально —
 *     BullMQ умеет их хранить).
 */
export const CORE_QUEUE_NAMES = {
  /** Универсальная очередь raw events для ingest pipeline. */
  RAW_EVENTS: 'core.raw-events',
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
