/**
 * Pulse Wave 5 §5.1 (2026-05-30) — DTO ответа `GET /api/v1/cycles/:id/dashboard/daily`.
 *
 * Источник: `SprintAnalystService.getDailyDigest()`. Не кэшируется в Redis
 * долго — daily-данные часто меняются (TTL 60 сек на уровне сервиса).
 *
 * EU AI Act §1.3: только структурированные метрики, никакой эмоциональной
 * аналитики. Топы по closer/helper — по факту закрытых задач и
 * HelpfulnessTrait, без рейтингов «лучше/хуже».
 */

export type SprintActivityColor = 'success' | 'warning' | 'danger';

export interface SprintDailyIssueWithActivityDto {
  issueId: string;
  identifier: string;
  title: string;
  assigneeName: string | null;
  lastActivity: string | null;
  activityColor: SprintActivityColor;
  stateCategory:
    | 'backlog'
    | 'unstarted'
    | 'started'
    | 'completed'
    | 'cancelled'
    | null;
}

export interface SprintDailyTopCloserDto {
  userId: string;
  name: string;
  closedCount: number;
}

export interface SprintDailyTopHelperDto {
  userId: string;
  name: string;
  helpfulnessScore: number;
}

export interface SprintDailyDigestDto {
  cycleId: string;
  hypothesisText: string | null;
  /** Связный markdown-нарратив AI Daily Standup от LLM. null — если LLM упал. */
  aiNarrative: string | null;
  issuesWithActivity: SprintDailyIssueWithActivityDto[];
  topClosers: SprintDailyTopCloserDto[];
  topHelpers: SprintDailyTopHelperDto[];
  alarmCount: number;
  generatedAt: string;
}
