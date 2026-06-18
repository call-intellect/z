import { z } from 'zod';

export const DeliveriesQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['pending', 'retrying', 'delivered', 'failed']).optional(),
  url: z.string().trim().min(1).max(255).optional(),
});
export type DeliveriesQueryDto = z.infer<typeof DeliveriesQuerySchema>;

export interface ActiveWebhookRowDto {
  id: string;
  tenantId: string | null;
  url: string;
  events: ReadonlyArray<string>;
  status: string;
  lastDeliveryAt: string | null;
  createdAt: string;
}

export interface DeliveryRowDto {
  id: string;
  subscriptionId: string;
  url: string | null;
  event: string;
  status: string;
  attempts: number;
  lastStatus: number | null;
  lastResponse: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

export interface DeliveriesPageDto {
  items: DeliveryRowDto[];
  nextCursor: string | null;
}

export interface RetryDeliveryResponseDto {
  ok: boolean;
  enqueued: boolean;
  message: string;
}
