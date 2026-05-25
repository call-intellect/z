/**
 * Admin-redesign Фаза 2 — DTO для `KnowledgeAnalyticsController`.
 *
 * Аналитика knowledge-core (read-only): totals по основным сущностям,
 * топ-Org по объёму графа, ежедневный рост блоков/тем/сущностей.
 *
 * Период — `day | week | month`. `period` влияет на:
 *  - `overview.*.growth` — приращение за период (createdAt > now - period).
 *  - `by-org` — фильтр по `createdAt` за период.
 *  - `growth` — гранулярность в днях за период.
 *
 * Источник правды — модели `IdeaBlock`, `Entity`, `Theme`, `IdeaBlockLink`,
 * `Card`, `Decision`, `Insight`, `Idea`, `Regulation`, `Process` из
 * [backend/prisma/schema.prisma](backend/prisma/schema.prisma).
 */

import { z } from 'zod';

export const KnowledgeOverviewQuerySchema = z.object({
  /** Период для приращения totals (default week). */
  period: z.enum(['day', 'week', 'month']).default('week'),
});
export type KnowledgeOverviewQueryDto = z.infer<
  typeof KnowledgeOverviewQuerySchema
>;

export const KnowledgeByOrgQuerySchema = z.object({
  /** Период для подсчёта приращения (default week). */
  period: z.enum(['day', 'week', 'month']).default('week'),
  /** Размер выборки топ-Org. */
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type KnowledgeByOrgQueryDto = z.infer<typeof KnowledgeByOrgQuerySchema>;

export const KnowledgeGrowthQuerySchema = z.object({
  /** Период для серии (week = 7 точек, month = 30 точек). */
  period: z.enum(['week', 'month']).default('week'),
});
export type KnowledgeGrowthQueryDto = z.infer<
  typeof KnowledgeGrowthQuerySchema
>;
