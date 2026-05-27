import { z } from 'zod';

import { IssuePrioritySchema } from './create-issue.dto';

/**
 * Query-параметры списка задач (`GET /projects/:projectId/issues`).
 * Все фильтры опциональны. `assigneeUserId` фильтрует по записи в
 * IssueAssignee (M:M). `labelId` — по IssueLabel. `goalId` — прямой FK.
 */
export const ListIssuesQuerySchema = z
  .object({
    stateId: z.string().max(64).optional(),
    /** `category` IssueState. Если передан — фильтр по category, а не stateId. */
    stateCategory: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
      .optional(),
    assigneeUserId: z.string().max(64).optional(),
    labelId: z.string().max(64).optional(),
    cycleId: z.string().max(64).optional(),
    goalId: z.string().max(64).optional(),
    /**
     * Tracker Boards (2026-05-27) — фильтр задач по доске. Без этого параметра
     * возвращаются все задачи проекта (поведение до Boards-ТЗ — сохраняется
     * для обратной совместимости фронта).
     */
    boardId: z.string().max(64).optional(),
    priority: IssuePrioritySchema.optional(),
    parentId: z.string().max(64).optional(),
    /** Включать ли архивные / удалённые (по умолчанию false). */
    includeArchived: z.coerce.boolean().default(false),
    includeDeleted: z.coerce.boolean().default(false),
    /** Текстовый поиск по title / descriptionStripped (ILIKE %q%). */
    q: z.string().max(200).optional(),
    /**
     * Tracker subtasks UI (2026-05-27) — если true, у каждого item в ответе
     * появляется поле `childrenCount: number` (число прямых детей с
     * `deletedAt=null`). Используется фронтом для отрисовки badge «N/M»
     * на канбан-карточке. Стоимость — один groupBy(parentId).
     */
    includeChildrenCount: z.coerce.boolean().default(false),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type ListIssuesQuery = z.infer<typeof ListIssuesQuerySchema>;

export const AddAssigneeSchema = z
  .object({ userId: z.string().min(1).max(64) })
  .strict();
export type AddAssigneeDto = z.infer<typeof AddAssigneeSchema>;

export const AddLabelSchema = z
  .object({ labelId: z.string().min(1).max(64) })
  .strict();
export type AddLabelDto = z.infer<typeof AddLabelSchema>;

export const LinkGoalSchema = z
  .object({ goalId: z.string().min(1).max(64) })
  .strict();
export type LinkGoalDto = z.infer<typeof LinkGoalSchema>;
