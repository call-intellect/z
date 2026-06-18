import { z } from 'zod';

export const CreateTicketSchema = z
  .object({
    subject: z.string().min(1).max(200),
    message: z.string().min(1).max(5_000),
    category: z.literal('technical').optional(),
  })
  .strict();

export type CreateTicketDto = z.infer<typeof CreateTicketSchema>;
