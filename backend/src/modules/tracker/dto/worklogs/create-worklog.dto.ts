import { z } from 'zod';

export const CreateWorklogSchema = z
  .object({
    minutes: z.number().int().min(1).max(10080),
    startedAt: z.string().datetime(),
    description: z.string().max(2000).optional(),
  })
  .strict();
export type CreateWorklogDto = z.infer<typeof CreateWorklogSchema>;
