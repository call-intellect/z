import { z } from 'zod';

export const RateTicketSchema = z
  .object({
    score: z.number().int().min(1).max(5),
    comment: z.string().max(2_000).optional(),
  })
  .strict();

export type RateTicketDto = z.infer<typeof RateTicketSchema>;
