/**
 * Pulse Wave 5 §5.2 (2026-05-30) — DTO ответа `GET /api/v1/cycles/:id/dashboard/weekly`.
 *
 * Источник: `SprintAnalystService.getWeeklyDigest()`. TTL 5 минут (как у
 * основного dashboard'а — weekly данные стабильны в рамках дня).
 */

export interface SprintWeeklyVelocityDto {
  /** Кол-во задач, закрытых за последние 7 дней. */
  closedThisWeek: number;
  /** Кол-во задач, закрытых в предыдущие 7 дней (для тренда). */
  closedPrevWeek: number;
  /** Тренд: 'up' если this > prev*1.1, 'down' если this < prev*0.9, иначе 'flat'. */
  trend: 'up' | 'flat' | 'down';
}

export interface SprintWeeklyTeamHealthRowDto {
  departmentId: string;
  departmentName: string;
  size: number;
  belowCohort: boolean;
  /** -100..+100 — индекс настроения. */
  sentiment: number | null;
  /** 0..100 % — надёжность обещаний. */
  promises: number | null;
}

export interface SprintWeeklyLearningDto {
  ideaBlockId: string;
  title: string;
  signalType: string;
}

export interface SprintWeeklyForecastDto {
  trend: 'improving' | 'stable' | 'declining' | null;
  /** Краткое summary expectedShifts. */
  summary: string | null;
  snapshotAt: string | null;
}

export interface SprintWeeklyDigestDto {
  cycleId: string;
  hypothesisText: string | null;
  /** Подтверждается ли гипотеза. null — спринт ещё идёт / нет данных. */
  hypothesisConfirmed: boolean | null;
  /** Связный markdown weekly summary от LLM. null — если LLM упал. */
  aiNarrative: string | null;
  velocity: SprintWeeklyVelocityDto;
  teamHealth: SprintWeeklyTeamHealthRowDto[];
  outcomeMetric: {
    completedPercent: number;
    completed: number;
    total: number;
  };
  /** Что узнали за неделю (IdeaBlock с signalType insight/knowledge_gap за период спринта). */
  learnings: SprintWeeklyLearningDto[];
  /** Action items для retro (заголовки активных подсказок helper'а). */
  actionItems: string[];
  forecast: SprintWeeklyForecastDto;
  generatedAt: string;
}
