import type { JobsOptions } from 'bullmq';

/**
 * Имена очередей AI-pipeline. Используются и dispatch'ером (HTTP-side), и
 * воркерами (worker-side). Префиксом `ai.` отделяем от не-AI очередей.
 */
export const QUEUE_NAMES = {
  TRANSCRIBE: 'ai.transcribe',
  MERGE: 'ai.merge',
  ANALYZE: 'ai.analyze',
  NOTIFY: 'ai.notify',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Дефолтные опции job'а для всех 4 стадий AI-pipeline.
 *
 *   attempts: 5                           — итого до 5 попыток с экспоненциальным backoff'ом.
 *   backoff: exponential delay 8000       — 8s, 16s, 32s, 64s между попытками.
 *   removeOnComplete: { age:24h, count:1000 } — успешные jobs не висят в Redis.
 *   removeOnFail: false                   — failed остаются для разбора + retry.
 */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 8000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

/**
 * Payload, который ждут все воркеры стадий AI-pipeline.
 *
 * `attempt` — номер попытки внутри одного `meetingId` (для `jobId` дедупа).
 *  Фактический attempt'ом BullMQ управляет сам; этот — наш «логический»
 *  для retry-сценариев (см. `RetryService`).
 */
export interface AiJobData {
  meetingId: string;
  attempt: number;
}
