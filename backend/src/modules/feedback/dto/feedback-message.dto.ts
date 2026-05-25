/**
 * DTO для пользовательских ответов:
 *   - GET /api/v1/feedback/my       (история своих сообщений)
 *   - GET /api/v1/feedback/my/limit (счётчик лимита 5/сутки)
 *
 * См. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// ─────────────────────── элемент списка ───────────────────────

export const FeedbackMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string().datetime(),
  /// ISO8601 либо null — момент, когда ночной воркер обработал сообщение.
  processedAt: z.string().datetime().nullable(),
});
export type FeedbackMessage = z.infer<typeof FeedbackMessageSchema>;
export class FeedbackMessageDto extends createZodDto(FeedbackMessageSchema) {}

// ─────────────────────── список с пагинацией ───────────────────────

export const FeedbackMessagesListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type FeedbackMessagesListQuery = z.infer<
  typeof FeedbackMessagesListQuerySchema
>;
export class FeedbackMessagesListQueryDto extends createZodDto(
  FeedbackMessagesListQuerySchema,
) {}

export const FeedbackMessagesListResponseSchema = z.object({
  items: z.array(FeedbackMessageSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type FeedbackMessagesListResponse = z.infer<
  typeof FeedbackMessagesListResponseSchema
>;
export class FeedbackMessagesListResponseDto extends createZodDto(
  FeedbackMessagesListResponseSchema,
) {}

// ─────────────────────── лимит на сутки ───────────────────────

export const FeedbackLimitResponseSchema = z.object({
  /// Сколько уже отправлено сегодня (UTC).
  usedToday: z.number().int().nonnegative(),
  /// Жёсткий лимит — пока константа 5, может стать ENV в фазе 2.
  limit: z.number().int().positive(),
  /// ISO8601 — момент, когда счётчик обнулится (полночь UTC).
  resetAt: z.string().datetime(),
});
export type FeedbackLimitResponse = z.infer<typeof FeedbackLimitResponseSchema>;
export class FeedbackLimitResponseDto extends createZodDto(
  FeedbackLimitResponseSchema,
) {}
