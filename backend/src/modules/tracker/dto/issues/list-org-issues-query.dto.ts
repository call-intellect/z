import { z } from 'zod';

import { IssuePrioritySchema } from './create-issue.dto';

/**
 * Query-параметры сквозного списка задач org (`GET /api/v1/issues`).
 * Все фильтры опциональны. `assigneeUserId` учитывается только для тех,
 * кто видит чужие задачи (руководитель ИЛИ visibilityMode=open) — иначе
 * сервис форсит self-scope. `q` — ILIKE %q% по title/descriptionStripped/identifier.
 */
export const ListOrgIssuesQuerySchema = z
  .object({
    projectId: z.string().max(64).optional(),
    assigneeUserId: z.string().max(64).optional(),
    stateCategory: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
      .optional(),
    priority: IssuePrioritySchema.optional(),
    cycleId: z.string().max(64).optional(),
    labelId: z.string().max(64).optional(),
    q: z.string().max(200).optional(),
    includeArchived: z.coerce.boolean().default(false),
    includeDeleted: z.coerce.boolean().default(false),
    includeChildrenCount: z.coerce.boolean().default(false),
    includeEngagementCount: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export type ListOrgIssuesQuery = z.infer<typeof ListOrgIssuesQuerySchema>;
