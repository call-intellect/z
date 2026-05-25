/**
 * DTO для FeedbackItem — тезисов, выделенных агентом из FeedbackMessage.
 * Используется на странице деталей блока в admin-UI.
 *
 * См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const FeedbackItemAuthorSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
});

export const FeedbackItemOrgSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .nullable();

export const FeedbackItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string().datetime(),
  /// Исходное FeedbackMessage.id — нужно для отдельного запроса
  /// «развернуть полный текст».
  messageId: z.string(),
  user: FeedbackItemAuthorSchema,
  org: FeedbackItemOrgSchema,
  discarded: z.boolean(),
  discardReason: z.string().nullable(),
});
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;
export class FeedbackItemDto extends createZodDto(FeedbackItemSchema) {}

export const FeedbackItemsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /// Группировать по пользователю (для опции в UI). Реализация — фаза 6.
  groupByUser: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});
export type FeedbackItemsListQuery = z.infer<
  typeof FeedbackItemsListQuerySchema
>;
export class FeedbackItemsListQueryDto extends createZodDto(
  FeedbackItemsListQuerySchema,
) {}

export const FeedbackItemsListResponseSchema = z.object({
  items: z.array(FeedbackItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackItemsListResponse = z.infer<
  typeof FeedbackItemsListResponseSchema
>;
export class FeedbackItemsListResponseDto extends createZodDto(
  FeedbackItemsListResponseSchema,
) {}

/// Ответ на «развернуть исходное сообщение» —
/// GET /admin/feedback/topics/:id/items/:itemId/message.
/// По ТЗ возвращаем плоские userId/orgId, плюс user/org для удобства UI.
export const FeedbackItemMessageResponseSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string().datetime(),
  userId: z.string(),
  orgId: z.string().nullable(),
  user: FeedbackItemAuthorSchema,
  org: FeedbackItemOrgSchema,
});
export type FeedbackItemMessageResponse = z.infer<
  typeof FeedbackItemMessageResponseSchema
>;
export class FeedbackItemMessageResponseDto extends createZodDto(
  FeedbackItemMessageResponseSchema,
) {}
