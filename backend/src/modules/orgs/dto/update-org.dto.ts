import { z } from 'zod';

/**
 * Обновление Org owner'ом: смена названия и/или visibilityMode.
 */
export const UpdateOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    visibilityMode: z.enum(['open', 'strict']).optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.visibilityMode !== undefined,
    'Хотя бы одно поле должно быть передано',
  );

export type UpdateOrgDto = z.infer<typeof UpdateOrgSchema>;
