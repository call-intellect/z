import { z } from 'zod';

export const ClientMessageSchema = z
  .object({
    message: z.string().min(1).max(5_000),
  })
  .strict();

export type ClientMessageDto = z.infer<typeof ClientMessageSchema>;
