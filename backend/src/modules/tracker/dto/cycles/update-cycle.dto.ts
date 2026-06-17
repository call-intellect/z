import { z } from 'zod';

export const UpdateCycleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    ownedById: z.string().max(64).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    timezone: z.string().max(64).optional(),
    primaryGoalId: z.string().min(1).nullable().optional(),
  })
  .strict();

export type UpdateCycleDto = z.infer<typeof UpdateCycleSchema>;
