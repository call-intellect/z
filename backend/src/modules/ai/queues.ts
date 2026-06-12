import type { JobsOptions } from 'bullmq';

/**
 * Имена очередей AI-pipeline. Используются и dispatch'ером (HTTP-side), и
 * воркерами (worker-side). Префиксом `ai.` отделяем от не-AI очередей.
 *
 * После `ai.analyze` orchestrator (см. `analyze.worker`) запускает стадию
 * индексации эмбеддингов `ai.embeddings` + ingest в knowledge-core. Главы,
 * задачи и качество встречи теперь делает ЕДИНЫЙ воркер `meeting-report-fast`
 * (core-очередь), отдельные `ai.chapters` / `ai.tasks` / `ai.quality-score`
 * упразднены.
 * `clip.render` — отдельная очередь для CPU-bound ffmpeg-задач (concurrency=1).
 */
export const QUEUE_NAMES = {
  TRANSCRIBE: 'ai.transcribe',
  MERGE: 'ai.merge',
  ANALYZE: 'ai.analyze',
  NOTIFY: 'ai.notify',
  EMBEDDINGS: 'ai.embeddings',
  CLIP_RENDER: 'clip.render',
  /** Пересборка `Card.summaryCache` после новой обработанной встречи в карточке. */
  CARD_ROLLUP: 'ai.card-rollup',
  /**
   * Фаза B — расчёт поведенческих метрик встречи. Ставится из `ai.merge`
   * параллельно `ai.analyze`. Результат — MeetingBehaviorMetrics +
   * MeetingParticipantBehavior[].
   */
  BEHAVIOR_METRICS: 'ai.behavior-metrics',
  /**
   * Фаза D — очистка транскрипта от слов-паразитов (sub-TZ D §7).
   * Independent очередь: enqueue либо из `ai.merge` (если включён
   * `Org.transcriptCleaningAuto`), либо по запросу `POST /meetings/:id/transcript/clean`.
   */
  TRANSCRIPT_CLEAN: 'ai.transcript-clean',
  /**
   * Фаза E — дополнительные («custom») AI-отчёты встречи. Enqueue только
   * on-demand (по запросу `POST /meetings/:id/reports` или regenerate).
   * Результат пишется в `MeetingReport`. См. ТЗ E §5.
   */
  CUSTOM_REPORT: 'ai.custom-report',
  /**
   * ТЗ 2026-06-03 meeting-recording-reliability, Фаза 3 — faststart-постобработка
   * composite MP4 (`ffmpeg -c copy -movflags +faststart`), чтобы браузер играл
   * видео прогрессивно (moov-atom в начало файла). Enqueue из webhook
   * `egress_ended`(composite) при включённом `RECORDING_FASTSTART_ENABLED`.
   * CPU/IO-bound, concurrency=1. Идемпотентность — фиксированный jobId по meetingId.
   */
  RECORDING_FASTSTART: 'recording.faststart',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Дефолтные опции job'а для стадий AI-pipeline.
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

/**
 * Payload `ai.custom-report` (Фаза E §5). Одно сообщение = один `MeetingReport`.
 * jobId формируется как `custom-report:<reportId>:<reason>:<attempt>` —
 * идемпотентность повторных enqueue в течение жизни job'а.
 */
export interface CustomReportJobData {
  meetingReportId: string;
  meetingId: string;
  reason: 'create' | 'regenerate';
  attempt: number;
}
