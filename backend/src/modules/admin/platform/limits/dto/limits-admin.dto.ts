import { z } from 'zod';

export const UpdateLimitSchema = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(1).max(1000).optional(),
});
export type UpdateLimitDto = z.infer<typeof UpdateLimitSchema>;
