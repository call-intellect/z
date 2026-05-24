import { z } from 'zod';

/**
 * DTO `POST /api/v1/projects/from-template` — создать проект из шаблона команды.
 *
 *   - `templateSlug` — slug TeamTemplate (sales | development | installation | ...).
 *     Сначала ищется per-tenant override, потом fallback к системному (tenantId=null).
 *   - `projectName` — отображаемое имя проекта.
 *   - `identifier` — префикс задач (2-5 заглавных букв; используется в формате PREFIX-123).
 *   - `slug` — короткий уникальный slug per tenant. Опц.: если не передан, формируется из identifier.toLowerCase().
 *   - `withExampleTasks` — создать 3 примера задач из шаблона (`typicalTasks`). По умолчанию `false`.
 */
export const CreateFromTemplateSchema = z
  .object({
    templateSlug: z
      .string()
      .min(2)
      .max(60)
      .regex(
        /^[a-z][a-z0-9_]*$/u,
        'Допустимы латинские буквы в нижнем регистре, цифры и подчёркивание',
      ),
    projectName: z.string().min(1).max(200),
    identifier: z
      .string()
      .min(2)
      .max(5)
      .regex(
        /^[A-Z][A-Z0-9]*$/u,
        'Только заглавные латинские буквы и цифры, начиная с буквы',
      ),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(
        /^[a-z0-9-]+$/u,
        'Допустимы только латинские буквы в нижнем регистре, цифры и дефис',
      )
      .optional(),
    withExampleTasks: z.boolean().default(false),
  })
  .strict();

export type CreateFromTemplateDto = z.infer<typeof CreateFromTemplateSchema>;
