import { z } from 'zod';

/**
 * Метка трекера. `projectId=null` → глобальная (на уровне Org).
 */
export const CreateLabelSchema = z
  .object({
    name: z.string().min(1).max(80),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/u, 'HEX-цвет вида #RRGGBB'),
    projectId: z.string().max(64).nullable().optional(),
  })
  .strict();
export type CreateLabelDto = z.infer<typeof CreateLabelSchema>;

export const UpdateLabelSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/u, 'HEX-цвет вида #RRGGBB')
      .optional(),
  })
  .strict();
export type UpdateLabelDto = z.infer<typeof UpdateLabelSchema>;

export const ListLabelsQuerySchema = z
  .object({
    projectId: z.string().max(64).optional(),
  })
  .strict();
export type ListLabelsQuery = z.infer<typeof ListLabelsQuerySchema>;
