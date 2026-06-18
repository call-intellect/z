import { z } from 'zod';

export const ListStatesQuerySchema = z
  .object({
    projectId: z.string().max(64).optional(),
    category: z.enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled']).optional(),
  })
  .strict();
export type ListStatesQuery = z.infer<typeof ListStatesQuerySchema>;
