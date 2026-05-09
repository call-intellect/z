import { z } from 'zod';

import { WEBHOOK_EVENTS } from '../webhook-events.types';

export const CreateSubscriptionSchema = z.object({
  url: z.string().url().max(2000),
  events: z
    .array(z.enum(WEBHOOK_EVENTS as unknown as [string, ...string[]]))
    .min(1)
    .max(50),
});

export type CreateSubscriptionDto = z.infer<typeof CreateSubscriptionSchema>;
