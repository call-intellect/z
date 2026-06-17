import { z } from 'zod';

export const CreatePushSubscriptionBodySchema = z.object({
  endpoint: z.string().url('endpoint должен быть валидным URL'),
  keys: z.object({
    p256dh: z.string().min(1, 'keys.p256dh обязателен'),
    auth: z.string().min(1, 'keys.auth обязателен'),
  }),
  expirationTime: z.number().int().positive().nullable().optional(),
  userAgent: z.string().max(500).optional(),
});
export type CreatePushSubscriptionBody = z.infer<typeof CreatePushSubscriptionBodySchema>;

export const DeletePushSubscriptionBodySchema = z.object({
  endpoint: z.string().url('endpoint должен быть валидным URL'),
});
export type DeletePushSubscriptionBody = z.infer<typeof DeletePushSubscriptionBodySchema>;

export interface PushSubscriptionView {
  id: string;
  endpoint: string;
  userAgent: string | null;
  lastSeenAt: string;
  createdAt: string;
}

export interface PushSubscriptionListResponse {
  items: PushSubscriptionView[];
}
