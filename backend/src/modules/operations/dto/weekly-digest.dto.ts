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
  /**
   * TZ-1 Ф4.A (daily-value-engine) — топ идей недели (по weight + свежесть
   * lastDiscussedAt). Опускается из дайджеста, если пусто (см. weekly-digest.prompt).
   */
  topIdeas?: Array<{
    ideaId: string;
    statement: string;
    status: string;
    weight: number;
    supporterCount: number;
  }>;
}

export interface WeeklyDigestSourcesDto {
  blockerCheckInIds: string[];
  insightIds: string[];
  goalIds: string[];
  decisionIds: string[];
  /** TZ-1 Ф4.A — id идей, попавших в секцию недели (drill-down). */
  ideaIds?: string[];
}

/**
 * Pulse Wave 2 §2.2 (2026-05-30) — Дельта одного KPI «текущая_неделя vs
 * предыдущая».
 *
 * Поле `unit` нужно UI: для процентных KPI рендерим как «{value}%», для
 * sentiment-индекса как «{value} pts», для счётчиков — «{value} шт».
 */
export interface WeeklyKpiDeltaDto {
  /** Лейбл, например 'Индекс настроения'. */
  label: string;
  /** Текущее значение (число; для % — 0..100, для индекса — -100..+100). */
  current: number;
  /** Предыдущее значение (`null` — нет данных). */
  previous: number | null;
  /** Дельта = current - previous (null если previous=null). */
  delta: number | null;
  /** Единица измерения для UI: '%' / 'pts' / 'шт'. */
  unit: '%' | 'pts' | 'шт';
}

/**
 * Pulse Wave 2 §2.2 — Динамика команды: лучшая/худшая по health-метрике
 * за неделю.
 *
 * Сигналы:
 *   - `sentiment_improved` / `sentiment_dropped` — изменение среднего sentiment
 *     по чек-инам сотрудников команды на ≥10 pts.
 *   - `promises_improved` / `promises_dropped` — изменение reliabilityPercent
 *     по обещаниям, адресованным сотрудникам команды (≥10 pp).
 */
export interface WeeklyTeamDynamicsRowDto {
  departmentId: string;
  departmentName: string;
  signal:
    | 'sentiment_improved'
    | 'sentiment_dropped'
    | 'promises_improved'
    | 'promises_dropped';
  /** Краткое описание (delta + размер команды). */
  detail: string;
}

/**
 * Pulse Wave 2 §2.2 — Прогноз тренда на следующую неделю.
 *
 * Простая линейная экстраполяция: проектируем дельту текущей недели на
 * следующую неделю. `confidence=medium` если |delta| ≥ 10 (визуально заметный
 * тренд), иначе `low`. `high` пока не используем — для high-confidence
 * нужен агент Forecaster (Волна 4.6).
 */
export interface WeeklyForecastItemDto {
  metric: 'sentiment' | 'promises' | 'hanging_decisions';
  /** Текстовая формулировка прогноза. */
  projection: string;
  confidence: 'low' | 'medium';
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
  // ────────── Pulse Wave 2 §2.2 — расширенные runtime-секции ──────────
  /** 4 KPI с дельтами к прошлой неделе. */
  kpiDeltas: WeeklyKpiDeltaDto[];
  /** Команды, которые выделились — улучшение или ухудшение (max 6). */
  teamDynamics: WeeklyTeamDynamicsRowDto[];
  /** Прогноз тренда на следующую неделю (3 элемента: sentiment/promises/hanging). */
  forecast: WeeklyForecastItemDto[];
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
