import { z } from 'zod';

export const DeskAssignSchema = z
  .object({
    userId: z.string().min(1).max(64),
  })
  .strict();

export type DeskAssignDto = z.infer<typeof DeskAssignSchema>;
