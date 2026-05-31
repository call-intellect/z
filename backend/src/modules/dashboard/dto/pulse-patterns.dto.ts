import { z } from 'zod';

/**
 * DTO эндпоинта `GET /api/v1/dashboard/pulse-patterns?period=week|month`.
 *
 * Pulse Wave 6 §6 — единый агрегатор паттернов для главной директора.
 * Снимает 7 виджетов: Bus Factor, Topic Recurrence, Low-ROI Meetings,
 * Bottleneck Heatmap, Goal Vector, Knowledge Velocity, Decision Hygiene.
 *
 * Все данные — из последних snapshot'ов cron'ов Волны 6
 * (`KnowledgeRiskSnapshot`, `RecurringTopic`, `Meeting.roiScore`,
 * `CrossFunctionalFrictionReport`, `PersonGoalContribution`,
 * `KnowledgeVelocitySnapshot`, `Decision.reversibility`).
 *
 * Новых cron'ов не вводим — только агрегируем существующие источники.
 */

export const PulsePatternsQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
});
export type PulsePatternsQuery = z.infer<typeof PulsePatternsQuerySchema>;

// ─── §6.1 — Bus Factor ──────────────────────────────────────────────────────

export interface PulsePatternBusFactorItemDto {
  /** Имя категории знаний (PersonKnowledgeCategoryEmbedding.categoryName). */
  categoryName: string;
  /** Сколько Person с confidence='high' (`KnowledgeRiskSnapshot.highConfidenceCount`). */
  expertsCount: number;
  /** Имена топ-экспертов (из `topExpertsJson.experts[].name`). */
  topExperts: string[];
}

export interface PulsePatternBusFactorDto {
  /** Топ-N категорий с riskLevel='critical'. */
  critical: PulsePatternBusFactorItemDto[];
  /** Сколько категорий с riskLevel='warning' за последние сутки. */
  warningCount: number;
  /** Всего категорий, по которым есть snapshot. */
  totalCategories: number;
}

// ─── §6.2 — Topic Recurrence ────────────────────────────────────────────────

export interface PulsePatternRecurringTopicItemDto {
  themeId: string | null;
  themeName: string;
  mentionCount: number;
  meetingCount: number;
  windowDays: number;
}

export interface PulsePatternRecurringTopicDto {
  topics: PulsePatternRecurringTopicItemDto[];
}

// ─── §6.3 — Low-ROI Meetings ────────────────────────────────────────────────

export interface PulsePatternLowRoiMeetingItemDto {
  meetingId: string;
  title: string;
  durationMinutes: number;
  participantCount: number;
  /** `Meeting.roiScore` — Decimal(8,3) → number. */
  roiScore: number;
  /** ISO. */
  startedAt: string;
}

export interface PulsePatternLowRoiMeetingDto {
  meetings: PulsePatternLowRoiMeetingItemDto[];
}

// ─── §6.4 — Cross-functional Bottleneck Heatmap ────────────────────────────

export interface PulsePatternBottleneckDepartmentDto {
  id: string;
  name: string;
}

export interface PulsePatternBottleneckTopPairDto {
  fromName: string;
  toName: string;
  severity: number;
}

export interface PulsePatternBottleneckDto {
  /**
   * 2D-матрица heatmap. `heatmap[i][j]` — сумма severity (low=1, medium=2,
   * high=3) трения из департамента `departments[i]` в `departments[j]`.
   * Размерность — `departments.length × departments.length`.
   *
   * Если в `involvedDepartmentIds` < 2 отделов — трение засчитывается на
   * диагональ (внутри отдела). При > 2 отделов — учитываем все пары
   * (fromIdx, toIdx) where fromIdx ≠ toIdx.
   */
  heatmap: number[][];
  departments: PulsePatternBottleneckDepartmentDto[];
  /** Top-5 наибольших пар (без диагонали). */
  topPairs: PulsePatternBottleneckTopPairDto[];
}

// ─── §6.6 — Goal Vector ─────────────────────────────────────────────────────

export interface PulsePatternGoalContributorDto {
  personName: string;
  netScore: number;
}

export interface PulsePatternGoalVectorItemDto {
  goalId: string;
  goalTitle: string;
  /** Суммарный netScore за окно (`personGoalContribution.netScore`). */
  netScore: number;
  topContributors: PulsePatternGoalContributorDto[];
}

export interface PulsePatternGoalVectorDto {
  goals: PulsePatternGoalVectorItemDto[];
}

// ─── §6.7 — Knowledge Velocity ──────────────────────────────────────────────

export interface PulsePatternKnowledgeVelocityResponderDto {
  personName: string;
  resolvedCount: number;
}

export interface PulsePatternKnowledgeVelocityDto {
  /** Медиана часов от вопроса до ответа. NULL если нет данных. */
  medianHours: number | null;
  resolvedGapsCount: number;
  openGapsCount: number;
  topResponders: PulsePatternKnowledgeVelocityResponderDto[];
}

// ─── §6.8 — Decision Hygiene (Bezos type-1) ─────────────────────────────────

export interface PulsePatternIrreversibleDecisionItemDto {
  decisionId: string;
  /** `Decision.statement` (или legacy `text`) — truncate до 280 символов. */
  statement: string;
  /** ISO `Decision.decidedAt || Decision.createdAt`. */
  decidedAt: string;
  hasAlternatives: boolean;
}

export interface PulsePatternIrreversibleDecisionsDto {
  decisions: PulsePatternIrreversibleDecisionItemDto[];
  /** Сколько type-1 решений без альтернатив (важно для алерта на главной). */
  alertCount: number;
}

// ─── Корневой DTO ───────────────────────────────────────────────────────────

export interface PulsePatternsDto {
  period: 'week' | 'month';
  generatedAt: string;
  busFactor: PulsePatternBusFactorDto;
  recurringTopics: PulsePatternRecurringTopicDto;
  lowRoiMeetings: PulsePatternLowRoiMeetingDto;
  bottlenecks: PulsePatternBottleneckDto;
  goalVector: PulsePatternGoalVectorDto;
  knowledgeVelocity: PulsePatternKnowledgeVelocityDto;
  irreversibleDecisions: PulsePatternIrreversibleDecisionsDto;
}
