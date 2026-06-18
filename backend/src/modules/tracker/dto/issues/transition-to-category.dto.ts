import { z } from 'zod';

/**
 * Перевод задачи в статус её проекта, соответствующий выбранной КАТЕГОРИИ.
 * Используется доской «Все проекты» (`OrgBoard`): колонки — 5 универсальных
 * категорий, у разных проектов разные наборы статусов. Эндпоинт резолвит
 * целевой статус по (projectId задачи + category) и делегирует в transitionState.
 */
export const TransitionToCategorySchema = z
  .object({
    category: z.enum([
      'backlog',
      'unstarted',
      'started',
      'completed',
      'cancelled',
    ]),
    reason: z.string().max(500).nullish(),
  })
  .strict();

export type TransitionToCategoryDto = z.infer<typeof TransitionToCategorySchema>;
