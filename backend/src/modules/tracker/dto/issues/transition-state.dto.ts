import { z } from 'zod';

/**
 * Смена статуса задачи. Используется отдельным эндпоинтом
 * `POST /issues/:id/transitions`, чтобы в IssueActivity verb='status_changed'
 * было самостоятельным событием (для лент и графа).
 */
export const TransitionIssueStateSchema = z
  .object({
    stateId: z.string().min(1).max(64),
    /** Опциональный комментарий о причине перевода (для аудита). */
    reason: z.string().max(2_000).nullable().optional(),
  })
  .strict();

export type TransitionIssueStateDto = z.infer<typeof TransitionIssueStateSchema>;
