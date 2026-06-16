import { z } from 'zod';

export const DeskListQuerySchema = z
  .object({
    view: z.enum(['unassigned', 'mine', 'all', 'closed', 'spam']).optional(),
    cursor: z.string().optional(),
  })
  .strict();

export type DeskListQueryDto = z.infer<typeof DeskListQuerySchema>;
