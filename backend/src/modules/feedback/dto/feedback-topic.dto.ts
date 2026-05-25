/**
 * DTO для смысловых блоков (FeedbackTopic):
 *   - элемент агрегированного списка `/admin/feedback/topics`
 *   - детальное представление одного блока `/admin/feedback/topics/:id`
 *
 * См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md
 * раздел «Админские эндпоинты».
 */

import { FeedbackTopicStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedbackTopicStatusSchema = z.nativeEnum(FeedbackTopicStatus);

/// Агрегированная строка блока в дашборде (с метриками за выбранное окно).
export const FeedbackTopicSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  status: FeedbackTopicStatusSchema,
  itemsCount: z.number().int().nonnegative(),
  uniqueUsersCount: z.number().int().nonnegative(),
  /// Доля items блока от всех items в выбранном окне (0..100).
  percentOfWindow: z.number().min(0).max(100),
  lastItemAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type FeedbackTopicSummary = z.infer<typeof FeedbackTopicSummarySchema>;
export class FeedbackTopicSummaryDto extends createZodDto(
  FeedbackTopicSummarySchema,
) {}

/// Ответ дашборда: список блоков + общие метрики окна.
export const FeedbackTopicsListResponseSchema = z.object({
  items: z.array(FeedbackTopicSummarySchema),
  totalItemsInWindow: z.number().int().nonnegative(),
  totalUsersInWindow: z.number().int().nonnegative(),
  totalTopicsInWindow: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackTopicsListResponse = z.infer<
  typeof FeedbackTopicsListResponseSchema
>;
export class FeedbackTopicsListResponseDto extends createZodDto(
  FeedbackTopicsListResponseSchema,
) {}

/// Детали блока для страницы `/admin/feedback/:id`.
export const FeedbackTopicDetailSchema = FeedbackTopicSummarySchema.extend({
  archivedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  mergedIntoId: z.string().nullable(),
});
export type FeedbackTopicDetail = z.infer<typeof FeedbackTopicDetailSchema>;
export class FeedbackTopicDetailDto extends createZodDto(
  FeedbackTopicDetailSchema,
) {}
