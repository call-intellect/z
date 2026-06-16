import { z } from 'zod';

/**
 * Перенос задачи в другой проект. Используется отдельным эндпоинтом
 * `POST /issues/:id/move` body `{ targetProjectId }`.
 *
 * Явный verb (а не перегрузка PATCH `projectId`), потому что перенос — это
 * атомарная ре-аллокация sequenceId / identifier / state / board / cycle
 * (см. `IssuesService.moveToProject`), а не простая смена поля. ТЗ
 * `plans/tz/2026-06-15-issue-move-to-project.md`.
 */
export const MoveIssueSchema = z
  .object({
    /** id целевого проекта (того же tenant'а, не архивный). */
    targetProjectId: z.string().min(1).max(64),
  })
  .strict();

export type MoveIssueDto = z.infer<typeof MoveIssueSchema>;
