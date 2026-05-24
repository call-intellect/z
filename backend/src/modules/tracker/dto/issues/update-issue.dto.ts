import { z } from 'zod';

import { IssuePrioritySchema } from './create-issue.dto';

/**
 * PATCH задачи. Каждое поле — опциональное. Если поле передано, оно
 * пишется в IssueActivity отдельной строкой через ActivityRecorderService.
 *
 * Смена `stateId` ВОЗМОЖНА через PATCH, но рекомендуется отдельный
 * `POST /issues/:id/transitions` (более явный verb='status_changed').
 */
export const UpdateIssueSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(50_000).nullable().optional(),
    descriptionHtml: z.string().max(80_000).nullable().optional(),
    descriptionStripped: z.string().max(50_000).nullable().optional(),
    priority: IssuePrioritySchema.optional(),
    stateId: z.string().max(64).nullable().optional(),
    parentId: z.string().max(64).nullable().optional(),
    estimatePoints: z.number().int().min(0).max(1000).nullable().optional(),
    sortOrder: z.number().int().optional(),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    cycleId: z.string().max(64).nullable().optional(),
    goalId: z.string().max(64).nullable().optional(),
    /**
     * Wave 3 finishing (Sprint 10, 2026-05-24) — то же, что в CreateIssueDto:
     * учитывать ли праздники при обновлении `dueDate`. Если поле не передано
     * — default `true` (сдвигаем); если `false` — сохраняем `dueDate` как есть.
     */
    respectHolidays: z.boolean().optional(),
  })
  .strict();

export type UpdateIssueDto = z.infer<typeof UpdateIssueSchema>;
