import type { JobsOptions } from 'bullmq';

/**
 * Имена очередей трекера. Префикс `tracker.` отделяет от очередей
 * AI-pipeline (`ai.*`) и knowledge-core (`core.*`).
 *
 * - `tracker.webhook-delivery` — исходящая доставка outgoing webhooks
 *   (HMAC-SHA256 подпись + exponential backoff retry).
 * - `core.issue-embed` — Tracker Phase 3 (Sprint 6, 2026-05-24): пересчёт
 *   pgvector-embedding'а для Issue.title+description (HNSW cosine), нужен
 *   для KNN «похожие задачи» и issue-goal-suggest. Префикс `core.` потому
 *   что embedding — общий ресурс второго мозга (knowledge-core), а
 *   tracker лишь триггерит пересчёт на create/update.
 */
export const TRACKER_QUEUE_NAMES = {
  WEBHOOK_DELIVERY: 'tracker.webhook-delivery',
  ISSUE_EMBED: 'core.issue-embed',
  /**
   * Wave 3 / Tracker Phase 3 part B (2026-05-24) — auto-triage Intake.
   * На каждый новый IntakeIssue ставим job → LLM `intake-auto-triage`
   * заполняет `suggested*` поля + confidence. При confidence ≥ 0.92 +
   * source='meeting' + suggestedAssigneeId → создаётся Issue автоматически
   * (IntakeIssue.status = 'accepted', createdIssueId).
   * Префикс `core.` — auto-triage логически часть AI-pipeline.
   */
  INTAKE_AUTO_TRIAGE: 'core.intake-auto-triage',
  /**
   * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — импорт задач из
   * внешних трекеров (Trello / Bitrix24 / Я.Трекер). Один ImportLog =
   * один job. Воркер работает в основном процессе (внутри backend),
   * concurrency=2. Префикс `core.` — импорт это разовая операция уровня
   * tenant (knowledge ingestion), а не вспомогательный tracker-механизм.
   */
  IMPORT_TRACKER: 'core.imports',
} as const;

export type TrackerQueueName =
  (typeof TRACKER_QUEUE_NAMES)[keyof typeof TRACKER_QUEUE_NAMES];

/**
 * Backoff webhook'ов трекера (Phase 1 B1-2.2): 60s → 300s → 1500s → 7500s →
 * 37500s. Совпадает с формулой BullMQ `exponential`: `delay * 5^(attempt-1)`,
 * где `delay = 60_000ms`. Итого до 5 попыток.
 *
 * После 5 failed attempts (через listener `worker.on('failed', …)`)
 * вебхук деактивируется (`isActive=false`) — см. WebhookDeliveryWorker.
 */
export const WEBHOOK_DELIVERY_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 60_000 },
  // Успешные доставки удаляем через 24ч; failed оставляем для разбора (логи в БД).
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400, count: 1000 },
};

/**
 * Payload job'а доставки webhook'а.
 *
 *  - `webhookId` — id `IssueWebhook` (загружается воркером, чтобы прочитать
 *    свежее состояние `isActive` и `secretKey`).
 *  - `eventType` — типа `issue.created`, `cycle.completed` и т.д.
 *  - `payload` — тело события (что прилетит в `request.body`). Сериализуется
 *    JSON'ом, HMAC считается от raw-строки этого JSON.
 *  - `tenantId` — для observability и cross-check (защита от cross-tenant).
 *  - `enqueuedAt` — ISO-время постановки job'а (для idempotency на стороне приёмника).
 */
export interface WebhookDeliveryJobData {
  webhookId: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  enqueuedAt: string;
}

/**
 * Payload job'а пересчёта embedding'а для Issue (`core.issue-embed`,
 * Tracker Phase 3 / Sprint 6).
 *
 *  - `tenantId` — для cross-tenant защиты в UPDATE (WHERE tenantId=$).
 *  - `issueId` — какую задачу пересчитать.
 *
 * Текст и hash считаются ВНУТРИ воркера (БД уже единственный источник
 * правды; передавать text в job'е — лишний дубль и риск рассинхрона).
 *
 * Idempotent jobId формируется в `IssueEmbedQueueService.enqueue`:
 * `issue-embed:{issueId}:{embeddingHash || 'init'}` — повторные enqueue с
 * тем же hash игнорируются BullMQ.
 */
export interface IssueEmbedJobData {
  tenantId: string;
  issueId: string;
}

/** Backoff embedding-job'а: 3 попытки, 30s → 150s → 750s. */
export const ISSUE_EMBED_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400, count: 500 },
};

/**
 * Payload job'а auto-triage IntakeIssue.
 *
 *  - `tenantId` — для cross-tenant защиты (всех писем из БД фильтруем по
 *    tenantId).
 *  - `intakeIssueId` — какой IntakeIssue триажить.
 *
 * Idempotent jobId формируется в `IntakeAutoTriageQueueService.enqueue`:
 * `intake-auto-triage:{intakeIssueId}` — повторные enqueue в окне жизни
 * job'а игнорируются BullMQ. Если IntakeIssue уже triaged (triagedAt IS
 * NOT NULL) — worker сам пропустит.
 */
export interface IntakeAutoTriageJobData {
  tenantId: string;
  intakeIssueId: string;
}

/**
 * Backoff auto-triage'а: 5 попыток, 10s → 50s → 250s → 1250s → 6250s.
 * Долгий backoff на случай rate-limit'а LLM-провайдеров.
 */
export const INTAKE_AUTO_TRIAGE_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 7 * 86_400, count: 1000 },
};

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — payload job'а импорта.
 *
 *  - `tenantId` — для cross-tenant защиты (все запросы Prisma фильтруются).
 *  - `importLogId` — какой ImportLog обрабатывать. Параметры (jsonContent,
 *    selectedBoardIds, userMappings) хранятся в `ImportLog.paramsJson`,
 *    чтобы не дублировать большой объём в Redis.
 *
 * Идемпотентный jobId = `import-tracker:{importLogId}` — повторный enqueue
 * для того же ImportLog игнорируется BullMQ.
 */
export interface ImportTrackerJobData {
  tenantId: string;
  importLogId: string;
}

/**
 * Backoff для импорта: всего 1 попытка. Если упало — статус ImportLog
 * выставляется в 'failed', пользователь решает руками (повтор = новый
 * ImportLog). Автоматический retry удваивает нагрузку и риск дублей
 * (часть Issue'ев уже создалась). Идемпотентность на уровне
 * Issue.externalSource+externalId защищает от дублей при ручном повторе.
 */
export const IMPORT_TRACKER_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 7 * 86_400, count: 200 },
  removeOnFail: { age: 30 * 86_400, count: 200 },
};
