import { z } from 'zod';

/** DTO ответа клиента в своём тикете. ТЗ 2026-06-09 support-desk Ф1. */
export const ClientMessageSchema = z
  .object({
    message: z.string().min(1).max(5_000),
  })
  .strict();

export type ClientMessageDto = z.infer<typeof ClientMessageSchema>;
