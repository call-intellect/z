import { z } from 'zod';

import { IssuePrioritySchema } from './create-issue.dto';

/**
 * Query-параметры endpoint'а `GET /api/v1/me/inbox` — мои задачи
 * (assignee=currentUser) во всех проектах текущей организации.
 *
 * Пагинация — cursor-based (cursor = последний viewed issue.id +
 * limit). Если cursor не передан — первая страница.
 *
 * Все фильтры опциональны. `dueBefore`/`dueAfter` — ISO-даты,
 * фильтруют по Issue.dueDate.
 *
 * Sprint 3+ Frontend Wave 2: используется хуком `useMyInbox`.
 */
export const MyInboxQuerySchema = z
  .object({
    /** Категория статуса (backlog | unstarted | started | completed | cancelled). */
    stateCategory: z
      .enum(['backlog', 'unstarted', 'started', 'completed', 'cancelled'])
      .optional(),
    /** Конкретный stateId (если нужен точный фильтр по статусу). */
    stateId: z.string().max(64).optional(),
    /** Приоритет. */
    priority: IssuePrioritySchema.optional(),
    /** Фильтр по конкретному проекту (если null — все проекты). */
    projectId: z.string().max(64).optional(),
    /** Фильтр по метке. */
    labelId: z.string().max(64).optional(),
    /** Фильтр по циклу. */
    cycleId: z.string().max(64).optional(),
    /** dueDate <= dueBefore (ISO-дата). Полезно для «просроченных». */
    dueBefore: z.coerce.date().optional(),
    /** dueDate >= dueAfter (ISO-дата). */
    dueAfter: z.coerce.date().optional(),
    /** Включать архивные (по умолчанию false). */
    includeArchived: z.coerce.boolean().default(false),
    /** Включать удалённые (по умолчанию false). */
    includeDeleted: z.coerce.boolean().default(false),
    /** Курсор пагинации — `id` последней задачи предыдущей страницы. */
    cursor: z.string().max(64).optional(),
    /** Размер страницы (1..100, default 50). */
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MyInboxQuery = z.infer<typeof MyInboxQuerySchema>;
