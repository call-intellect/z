import type { JobsOptions } from 'bullmq';

/** Имя очереди исходящих webhooks. Не префиксуем `ai.`, чтобы отделить. */
export const WEBHOOK_DELIVERY_QUEUE = 'webhook.delivery';

export interface WebhookDeliveryJobData {
  deliveryId: string;
}

export const WEBHOOK_JOB_OPTIONS: JobsOptions = {
  // Retry организован на уровне нашего worker'а через `nextAttemptAt`
  // (мы хотим экспоненциальный backoff и фиксированный max-attempts по нашему
  // правилу, не BullMQ). BullMQ-attempts оставляем 1, чтобы не было двойного
  // ретрая.
  attempts: 1,
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400, count: 1000 },
};
