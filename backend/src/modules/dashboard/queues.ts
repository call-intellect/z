import type { JobsOptions } from 'bullmq';

/**
 * BullMQ-очереди модуля Dashboard.
 *
 * Префикс `dashboard.` отделяет от `ai.*` (AI-pipeline встреч) и `core.*`
 * (knowledge-core ingest). Используется event-driven воркерами Pulse Wave 6,
 * для которых cron-проход не подходит (Meeting ROI пересчитывается на каждую
 * новую встречу; Decision Hygiene — на каждое новое решение).
 */
export const DASHBOARD_QUEUE_NAMES = {
  /**
   * Pulse Wave 6 §6.3 — Meeting-ROI-Scorer. Consumer —
   * `MeetingRoiScorerWorker`. Producer — `analyze.worker` (после ai_ready)
   * через `DashboardQueueService.enqueueMeetingRoi`.
   *
   * jobId = `meeting-roi:<meetingId>` — идемпотентно: повторный enqueue в
   * течение жизни той же job'ы Redis игнорируется. Сам worker детерминистически
   * пересчитывает Meeting.roiScore.
   */
  MEETING_ROI: 'dashboard.meeting-roi',
  /**
   * Pulse Wave 6 §6.8 — Decision-Hygiene-Scorer. Consumer —
   * `DecisionHygieneScorerWorker`. Producer — `Specialist33DecisionsWorker`
   * (после `processBlock`) через `DashboardQueueService.enqueueDecisionHygiene`
   * для каждого нового Decision с reversibility=null.
   *
   * jobId = `decision-hygiene:<decisionId>` — идемпотентно. Worker skip'ает,
   * если Decision.reversibility !== null (повторный прогон не меняет вердикт).
   */
  DECISION_HYGIENE: 'dashboard.decision-hygiene',
} as const;

export type DashboardQueueName =
  (typeof DASHBOARD_QUEUE_NAMES)[keyof typeof DASHBOARD_QUEUE_NAMES];

/**
 * Опции воркера ROI: 3 ретрая (детерминистический расчёт, основная причина
 * fail — недоступность БД). Backoff умеренный, очередь дешёвая.
 */
export const MEETING_ROI_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: false,
};

/**
 * Опции воркера Decision-Hygiene: 3 ретрая (1 LLM-вызов, причина fail —
 * провайдер или невалидный JSON). LlmRouter сам ходит по tier-цепочке.
 */
export const DECISION_HYGIENE_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: false,
};

/**
 * Payload `dashboard.meeting-roi`. Тонкий — worker сам подтянет meeting и
 * счётчики из БД.
 */
export interface MeetingRoiJobData {
  meetingId: string;
}

/**
 * Payload `dashboard.decision-hygiene`. Тонкий — worker сам подтянет
 * Decision (statement / rationale / alternatives) из БД.
 */
export interface DecisionHygieneJobData {
  decisionId: string;
  tenantId: string;
}
