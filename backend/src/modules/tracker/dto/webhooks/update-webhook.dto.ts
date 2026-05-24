import { z } from 'zod';

import { WebhookEventSchema } from './create-webhook.dto';

/**
 * PATCH webhook. `secretKey` через PATCH не меняется — для ротации будет
 * отдельный action `POST /webhooks/:id/rotate-secret` (Sprint 2).
 */
export const UpdateWebhookSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    url: z.string().url().max(2_048).optional(),
    events: z.array(WebhookEventSchema).min(1).max(32).optional(),
    isActive: z.boolean().optional(),
    isInternal: z.boolean().optional(),
  })
  .strict();

export type UpdateWebhookDto = z.infer<typeof UpdateWebhookSchema>;

export const WebhookLogsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type WebhookLogsQuery = z.infer<typeof WebhookLogsQuerySchema>;
