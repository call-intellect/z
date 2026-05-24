import type { JobsOptions } from 'bullmq';

/**
 * Имена очередей трекера. Префикс `tracker.` отделяет от очередей
 * AI-pipeline (`ai.*`) и knowledge-core (`core.*`).
 *
 * - `tracker.webhook-delivery` — исходящая доставка outgoing webhooks
 *   (HMAC-SHA256 подпись + exponential backoff retry).
 */
export const TRACKER_QUEUE_NAMES = {
  WEBHOOK_DELIVERY: 'tracker.webhook-delivery',
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
