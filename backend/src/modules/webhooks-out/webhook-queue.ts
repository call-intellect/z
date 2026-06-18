import type { JobsOptions } from 'bullmq';

export const WEBHOOK_DELIVERY_QUEUE = 'webhook.delivery';

export interface WebhookDeliveryJobData {
  deliveryId: string;
}

export const WEBHOOK_JOB_OPTIONS: JobsOptions = {
  attempts: 1,
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86400, count: 1000 },
};
