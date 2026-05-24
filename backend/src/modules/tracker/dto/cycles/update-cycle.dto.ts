import { z } from 'zod';

/**
 * PATCH цикла. Завершить цикл нельзя через PATCH — для этого
 * отдельный endpoint `POST /cycles/:id/complete`, который ещё запускает
 * auto-rollover незакрытых задач.
 */
export const UpdateCycleSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    ownedById: z.string().max(64).nullable().optional(),
    description: z.string().max(10_000).nullable().optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict();

export type UpdateCycleDto = z.infer<typeof UpdateCycleSchema>;
