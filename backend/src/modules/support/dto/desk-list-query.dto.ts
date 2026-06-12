import { z } from 'zod';

/**
 * DTO фильтра очереди деска. ТЗ 2026-06-09 support-desk Ф1.
 *
 * `view`: unassigned (без ассайни) | mine (на текущего сотрудника) | all |
 * closed (state.category ∈ completed|cancelled) | spam (state 'Спам').
 * `cursor` — keyset-пагинация (в Ф1 не используется; см. сервис).
 */
export const DeskListQuerySchema = z
  .object({
    view: z.enum(['unassigned', 'mine', 'all', 'closed', 'spam']).optional(),
    cursor: z.string().optional(),
  })
  .strict();

export type DeskListQueryDto = z.infer<typeof DeskListQuerySchema>;
