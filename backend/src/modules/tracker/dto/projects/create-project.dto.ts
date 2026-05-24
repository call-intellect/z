import { z } from 'zod';

/**
 * DTO создания проекта трекера. `slug` уникален per tenant; `identifier` —
 * префикс задач (KORA, SALES) длиной до 5 символов; используется в формате
 * `{identifier}-{sequenceId}` (например `KORA-123`).
 */
export const CreateProjectSchema = z
  .object({
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9-]+$/u, 'Допустимы только латинские буквы в нижнем регистре, цифры и дефис'),
    identifier: z
      .string()
      .min(2)
      .max(5)
      .regex(/^[A-Z][A-Z0-9]*$/u, 'Только заглавные латинские буквы и цифры, начиная с буквы'),
    name: z.string().min(1).max(200),
    description: z.string().max(10_000).nullable().optional(),
    defaultAssigneeId: z.string().max(64).nullable().optional(),
    network: z.union([z.literal(0), z.literal(2)]).default(0),
    timezone: z.string().max(64).default('Europe/Moscow'),
    cycleViewEnabled: z.boolean().default(true),
    intakeViewEnabled: z.boolean().default(true),
    gantViewEnabled: z.boolean().default(false),
    timeTrackingEnabled: z.boolean().default(false),
    teamTemplateId: z.string().max(64).nullable().optional(),
  })
  .strict();

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
