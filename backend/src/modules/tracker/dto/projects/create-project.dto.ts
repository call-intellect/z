import { z } from 'zod';

/**
 * DTO создания проекта трекера. `slug` уникален per tenant; `identifier` —
 * префикс задач (KORA, SALES) длиной до 5 символов; используется в формате
 * `{identifier}-{sequenceId}` (например `KORA-123`).
 *
 * Sprints (2026-05-27) — 4 опц. scope-поля гибкой привязки спринта-проекта:
 * customerCardId / vendorId / subjectPersonId / departmentId. Инвариант:
 * заполнено не более одного. См. plans/tz/2026-05-27-sprints.md §1.6.
 */
export const CreateProjectSchema = z
  .object({
    // D2 (ТЗ 2026-06-11): slug/identifier опциональны — если не переданы,
    // сервер генерит их из `name` (транслит + уникальный суффикс) внутри
    // транзакции. Regex-валидация остаётся для случая «передан явно».
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9-]+$/u, 'Допустимы только латинские буквы в нижнем регистре, цифры и дефис')
      .optional(),
    identifier: z
      .string()
      .min(2)
      .max(5)
      .regex(/^[A-Z][A-Z0-9]*$/u, 'Только заглавные латинские буквы и цифры, начиная с буквы')
      .optional(),
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
    customerCardId: z.string().max(64).nullable().optional(),
    vendorId: z.string().max(64).nullable().optional(),
    subjectPersonId: z.string().max(64).nullable().optional(),
    departmentId: z.string().max(64).nullable().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const filled = [v.customerCardId, v.vendorId, v.subjectPersonId, v.departmentId]
      .filter((x): x is string => typeof x === 'string' && x.length > 0)
      .length;
    if (filled > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Можно заполнить не более одного scope-поля (customerCardId / vendorId / subjectPersonId / departmentId)',
        path: ['customerCardId'],
      });
    }
  });

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
