import { z } from 'zod';

/**
 * SBA β-8.1 — DTO `WeeklyOperationsDigest`.
 *
 * Источник: plans/tz/2026-05-24-sba-beta-8-1-coo-dobivka.md §5, §7.
 *
 *   - `metrics` — структурированные показатели (для виджетов на странице
 *     /dashboard/operations/weekly).
 *   - `sources` — провенанс (id источников, для drill-down).
 *   - `bodyMarkdown` — связный текст комментария от LLM.
 */

export interface WeeklyDigestMetricsDto {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topBlockers: Array<{ text: string; count: number }>;
  topInsights: Array<{ insightId: string; statement: string; kind: string; dynamicLabel: string }>;
  goals: {
    completed: number;
    failed: number;
    inProgress: number;
    completedDelta: number;
    failedDelta: number;
  };
  hangingDecisions: Array<{ decisionId: string; statement: string; ageDays: number }>;
}

export interface WeeklyDigestSourcesDto {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
  decisionIds: string[];
}

export interface WeeklyOperationsDigestDto {
  id: string;
  tenantId: string;
  /** YYYY-MM-DD, понедельник. */
  weekStart: string;
  /** YYYY-MM-DD, воскресенье. */
  weekEnd: string;
  bodyMarkdown: string;
  metrics: WeeklyDigestMetricsDto;
  sources: WeeklyDigestSourcesDto;
  llmTaskRouteId: string | null;
  createdAt: string;
}

/**
 * Query-схема для `GET /api/v1/dashboard/operations/weekly-digest?weekStart=YYYY-MM-DD`
 * и `POST /generate?weekStart=YYYY-MM-DD`.
 */
export const WeeklyDigestQuerySchema = z
  .object({
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'weekStart должен быть YYYY-MM-DD'),
  })
  .strict();

export type WeeklyDigestQuery = z.infer<typeof WeeklyDigestQuerySchema>;

/**
 * Query-схема для виджета «Температура команды».
 * `days` — окно в днях (1..90).
 */
export const TeamTemperatureQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(7),
  })
  .strict();

export type TeamTemperatureQuery = z.infer<typeof TeamTemperatureQuerySchema>;
