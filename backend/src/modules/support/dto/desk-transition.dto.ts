import { z } from 'zod';

export const DeskTransitionSchema = z
  .object({
    status: z.enum(['new', 'in_progress', 'waiting', 'resolved', 'closed', 'spam']),
  })
  .strict();

export type DeskTransitionDto = z.infer<typeof DeskTransitionSchema>;
