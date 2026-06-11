import { z } from 'zod';

/** DTO оценки тикета клиентом (CSAT 1..5). ТЗ 2026-06-09 support-desk Ф1. */
export const RateTicketSchema = z
  .object({
    score: z.number().int().min(1).max(5),
    comment: z.string().max(2_000).optional(),
  })
  .strict();

export type RateTicketDto = z.infer<typeof RateTicketSchema>;
