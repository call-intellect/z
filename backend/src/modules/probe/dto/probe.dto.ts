import type { ProbeStatus } from '@prisma/client';
import { z } from 'zod';


export const ListProbeQueueQuerySchema = z
  .object({
    status: z
      .enum([
        'pending',
        'dispatched',
        'dropped_dedup',
        'dropped_rate_limit',
        'expired',
        'dropped_cold_start',
      ])
      .optional(),
    emittedByService: z.string().max(80).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListProbeQueueQuery = z.infer<typeof ListProbeQueueQuerySchema>;

export interface ProbeQueueItemDto {
  id: string;
  emittedByService: string;
  reason: string;
  status: ProbeStatus;
  recipientCandidates: string[];
  selectedRecipientId: string | null;
  priority: number;
  createdAt: string;
  dispatchedAt: string | null;
  expiresAt: string | null;
  dispatchedNotificationId: string | null;
}

export interface ListProbeQueueResponse {
  items: ProbeQueueItemDto[];
  total: number;
  page: number;
  limit: number;
}

export const MyProbeHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MyProbeHistoryQuery = z.infer<typeof MyProbeHistoryQuerySchema>;

export interface MyProbeHistoryItemDto {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: string;
  responseStatus: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface MyProbeHistoryResponse {
  items: MyProbeHistoryItemDto[];
  total: number;
  page: number;
  limit: number;
}
