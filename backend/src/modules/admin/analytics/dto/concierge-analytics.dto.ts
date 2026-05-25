/**
 * Admin-redesign Фаза 2 — DTO для `ConciergeAnalyticsController`.
 *
 * Аналитика Concierge-чата (read-only): метрики использования за период,
 * топ-запросов, no-answer-список.
 *
 * Источник правды — модель `ConciergeMessage` (+ `ConciergeConversation`)
 * из [backend/prisma/schema.prisma](backend/prisma/schema.prisma). См. SBA
 * γ-2 — Concierge Agent.
 *
 * Если в Org-Brain нет признака «не нашёл ответ» — `noAnswerRate` возвращается
 * как `null` (отображается как «нет данных» в UI).
 */

import { z } from 'zod';

export const ConciergeOverviewQuerySchema = z.object({
  /** Период для агрегации (default week). */
  period: z.enum(['day', 'week', 'month']).default('week'),
});
export type ConciergeOverviewQueryDto = z.infer<
  typeof ConciergeOverviewQuerySchema
>;

export const ConciergeTopQueriesQuerySchema = z.object({
  /** Период для топ-вопросов (default week). */
  period: z.enum(['day', 'week', 'month']).default('week'),
  /** Размер выборки топ-вопросов. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ConciergeTopQueriesQueryDto = z.infer<
  typeof ConciergeTopQueriesQuerySchema
>;

export const ConciergeNoAnswerQuerySchema = z.object({
  /** Период (default week). */
  period: z.enum(['day', 'week', 'month']).default('week'),
  /** Размер выборки (default 50). */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConciergeNoAnswerQueryDto = z.infer<
  typeof ConciergeNoAnswerQuerySchema
>;
