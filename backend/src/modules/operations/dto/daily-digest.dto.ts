import { z } from 'zod';

/**
 * SBA β-8.3 — DTO `DailyOperationsDigest`.
 *
 * Источник: plans/tz/2026-05-25-sba-beta-8-3-coo-daily-and-doelka.md §1.2, §1.5.
 *
 * Зеркало `WeeklyOperationsDigest` с окном «вчерашние сутки в МСК».
 *
 *   - `metrics` — структурированные показатели (для виджетов на странице
 *     /dashboard/operations/daily).
 *   - `sources` — провенанс (id источников, для drill-down).
 *   - `bodyMarkdown` — связный текст комментария от LLM (markdown).
 *   - `shortSummary` — 3-4 предложения для Telegram-рассылки и блока на главной.
 *   - `deliveredAt` — отметка успешной Telegram-доставки (NULL — не отправлено).
 */

export interface DailyDigestMetricsDto {
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  /** Топ-3 «красных» чек-инов (имя + первые 200 симв. rawResponseText). */
  topRedCheckIns: Array<{
    checkInId: string;
    personName: string | null;
    excerpt: string;
  }>;
  /** Новые блокеры за день (топ-5 по severity high → medium → low). */
  newBlockers: Array<{
    blockId: string;
    name: string;
    confidence: number;
  }>;
  /** Просроченные обещания на сегодня (топ-5). */
  overdueCommitments: Array<{
    blockId: string;
    name: string;
    dueDate: string | null;
    recipientPersonId: string | null;
  }>;
  /** Цели, у которых вчера изменился статус (completed / abandoned / active). */
  goals: {
    completed: number;
    failed: number;
    activated: number;
    /** Список id для drill-down. */
    completedIds: string[];
    failedIds: string[];
  };
  /** Новые high-severity инсайты за вчера. */
  newHighInsights: Array<{
    insightId: string;
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  /** Принятые / отвергнутые решения вчера. */
  decisions: Array<{
    decisionId: string;
    statement: string;
    status: string;
  }>;
}

export interface DailyDigestSourcesDto {
  checkInIds: string[];
  blockerIds: string[];
  commitmentIds: string[];
  goalIds: string[];
  insightIds: string[];
  decisionIds: string[];
}

export interface DailyOperationsDigestDto {
  id: string;
  tenantId: string;
  /** YYYY-MM-DD — дата отчёта в МСК (день, ЗА который сделан отчёт). */
  dateLocal: string;
  bodyMarkdown: string;
  shortSummary: string | null;
  metrics: DailyDigestMetricsDto;
  sources: DailyDigestSourcesDto;
  llmTaskRouteId: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

/**
 * Тип данных, передаваемых из `DailyDigestService.aggregate` в промпт.
 * Совпадает с `DailyDigestMetricsDto`, но без drill-down полей с id —
 * только то, что нужно LLM для генерации связного текста.
 */
export interface DailyDigestAggregates {
  dateLocal: string;
  totalCheckIns: number;
  greenShare: number;
  yellowShare: number;
  redShare: number;
  topRedCheckIns: Array<{ personName: string | null; excerpt: string }>;
  newBlockers: Array<{ name: string; confidence: number }>;
  overdueCommitments: Array<{ name: string; dueDate: string | null }>;
  goals: {
    completed: number;
    failed: number;
    activated: number;
  };
  newHighInsights: Array<{
    statement: string;
    kind: string;
    causeCategory: string | null;
  }>;
  decisions: Array<{ statement: string; status: string }>;
}

/**
 * Query-схема для `GET /api/v1/dashboard/operations/daily-digest?date=YYYY-MM-DD`
 * и `POST /generate?date=YYYY-MM-DD`.
 */
export const GetDailyDigestQuerySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date должен быть YYYY-MM-DD'),
  })
  .strict();

export type GetDailyDigestQuery = z.infer<typeof GetDailyDigestQuerySchema>;
