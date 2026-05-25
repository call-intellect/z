/**
 * DTO для фильтрации списка блоков в админке
 * `GET /api/v1/admin/feedback/topics`.
 *
 * См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Админские эндпоинты» — таблица /admin/feedback/topics.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedbackTopicWindowSchema = z.enum(['30', '90', 'all']);
export type FeedbackTopicWindow = z.infer<typeof FeedbackTopicWindowSchema>;

export const FeedbackTopicSortSchema = z.enum(['percent', 'users', 'recent']);
export type FeedbackTopicSort = z.infer<typeof FeedbackTopicSortSchema>;

export const TopicListFiltersSchema = z.object({
  window: FeedbackTopicWindowSchema.default('30'),
  /// Поиск по title + description (case-insensitive подстрока).
  q: z.string().trim().min(1).max(200).optional(),
  /// Показывать ли архивированные блоки. По умолчанию false.
  includeArchived: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
  sort: FeedbackTopicSortSchema.default('percent'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TopicListFilters = z.infer<typeof TopicListFiltersSchema>;
export class TopicListFiltersDto extends createZodDto(TopicListFiltersSchema) {}
