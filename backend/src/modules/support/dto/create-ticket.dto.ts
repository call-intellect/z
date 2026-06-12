import { z } from 'zod';

/**
 * DTO создания обращения в поддержку (клиентский intake).
 * ТЗ 2026-06-09 support-desk Ф1 §REST-контракт.
 *
 * `category` зарезервирован под расширение (v1 — только 'technical').
 */
export const CreateTicketSchema = z
  .object({
    subject: z.string().min(1).max(200),
    message: z.string().min(1).max(5_000),
    category: z.literal('technical').optional(),
  })
  .strict();

export type CreateTicketDto = z.infer<typeof CreateTicketSchema>;
