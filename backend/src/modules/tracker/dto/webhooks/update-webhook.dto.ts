import { z } from 'zod';

import { WebhookEventSchema } from './create-webhook.dto';

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
    success: z.coerce.boolean().optional(),
    since: z.coerce.date().optional(),
    until: z.coerce.date().optional(),
    eventType: z.string().min(1).max(64).optional(),
  })
  .strict();
export type WebhookLogsQuery = z.infer<typeof WebhookLogsQuerySchema>;
