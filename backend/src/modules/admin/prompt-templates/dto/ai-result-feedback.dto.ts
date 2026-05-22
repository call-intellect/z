/**
 * Фаза A.3 — DTO для feedback'а на AI-результат встречи (ТЗ A §7.3).
 *
 * POST /api/v1/meetings/:meetingId/result/feedback — пользователь оставляет 👍/👎.
 * GET  /api/v1/admin/feedback — список фидбека для аналитики (фильтры).
 */

import { z } from 'zod';

export const REACTIONS = ['positive', 'negative'] as const;
export type Reaction = (typeof REACTIONS)[number];

export const CreateFeedbackSchema = z.object({
  reaction: z.enum(REACTIONS),
  comment: z.string().max(2000).nullable().optional(),
});
export type CreateFeedbackDto = z.infer<typeof CreateFeedbackSchema>;

// ─── Admin: список ────────────────────────────────────────────────────

export const ListFeedbackQuerySchema = z.object({
  /** Фильтр по версии шаблона (через AiResult.promptTemplateVersionId). */
  versionId: z.string().min(1).max(60).optional(),
  /** Фильтр по корневому шаблону (через PromptTemplate.id) — найдёт все версии. */
  templateId: z.string().min(1).max(60).optional(),
  reaction: z.enum(REACTIONS).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Пагинация. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListFeedbackQueryDto = z.infer<typeof ListFeedbackQuerySchema>;
