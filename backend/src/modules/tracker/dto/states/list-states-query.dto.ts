import { z } from 'zod';

/**
 * Query-параметры `GET /api/v1/states` — список IssueState (статусов
 * задач) текущего tenant'а.
 *
 * `projectId` опционален: если передан — фильтр по конкретному проекту;
 * если null — все states организации (нужно для глобальных view, где
 * пользователь видит задачи из разных проектов и хочет общий справочник
 * статусов для фильтра).
 *
 * Frontend Wave 2: `useStates` (board, фильтр по статусу).
 */
export const ListStatesQuerySchema = z
  .object({
    projectId: z.string().max(64).optional(),
    category: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
      .optional(),
  })
  .strict();
export type ListStatesQuery = z.infer<typeof ListStatesQuerySchema>;
