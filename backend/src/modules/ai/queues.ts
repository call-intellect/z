import type { JobsOptions } from 'bullmq';

/**
 * Имена очередей AI-pipeline. Используются и dispatch'ером (HTTP-side), и
 * воркерами (worker-side). Префиксом `ai.` отделяем от не-AI очередей.
 *
 * После `ai.analyze` orchestrator (см. `analyze.worker`) запускает три
 * параллельные стадии: `ai.chapters`, `ai.tasks`, `ai.embeddings`.
 * `clip.render` — отдельная очередь для CPU-bound ffmpeg-задач (concurrency=1).
 */
export const QUEUE_NAMES = {
  TRANSCRIBE: 'ai.transcribe',
  MERGE: 'ai.merge',
  ANALYZE: 'ai.analyze',
  NOTIFY: 'ai.notify',
  CHAPTERS: 'ai.chapters',
  TASKS: 'ai.tasks',
  EMBEDDINGS: 'ai.embeddings',
  CLIP_RENDER: 'clip.render',
  /** Пересборка `Card.summaryCache` после новой обработанной встречи в карточке. */
  CARD_ROLLUP: 'ai.card-rollup',
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
 *
 * `templateId` — опц. UserTemplate.id для регенерации с кастомным шаблоном
 *  (только для `analyze` после regenerate).
 */
export interface AiJobData {
  meetingId: string;
  attempt: number;
  templateId?: string;
}

/**
 * Payload рендера клипа. Один highlight = одна job.
 */
export interface ClipRenderJobData {
  highlightId: string;
  attempt: number;
}

/**
 * Payload card-rollup. Один rollup = одна job; jobId фиксированный по cardId
 * и BullMQ дедуплицирует повторные постановки в окне дебаунса.
 */
export interface CardRollupJobData {
  cardId: string;
  /** Опциональная пометка причины — для логов и дебага. */
  reason?: 'analyze' | 'regenerate' | 'link' | 'unlink' | 'manual';
}
