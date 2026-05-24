/**
 * Типы WebSocket-событий трекера для фронта.
 * Зеркало `backend/src/modules/tracker/dto/ws-events.ts`.
 *
 * Полная типизация payload'ов — в Sprint 3, когда подключим socket.io-client
 * и фактически начнём получать события. Пока — только union типов.
 */

export type TrackerWsEventType =
  | 'issue.created'
  | 'issue.updated'
  | 'issue.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'cycle.created'
  | 'cycle.progress_updated'
  | 'cycle.completed'
  | 'intake.new_item'
  | 'intake.triaged'
  | 'activity_feed.new_item'
  | 'import.progress'
  | 'import.completed'
  | 'import.failed';

/**
 * Wave 3 / Tracker Phase 5 part 1 (2026-05-24) — payload-типы импорта.
 *
 * Backend источник: `backend/src/modules/tracker/dto/ws-events.ts`.
 * Эмиттер: `ImportTrackerWorker` (~ раз в 5 секунд на progress,
 * завершающее событие — completed / failed / cancelled→failed).
 */
export interface ImportProgressPayload {
  type: 'import.progress';
  tenantId: string;
  importLogId: string;
  processed: number;
  total: number;
  phase: string;
}

export interface ImportCompletedPayload {
  type: 'import.completed';
  tenantId: string;
  importLogId: string;
  summary: {
    totalProjects: number;
    totalIssues: number;
    totalComments: number;
    totalAttachments: number;
    errors: number;
  };
}

export interface ImportFailedPayload {
  type: 'import.failed';
  tenantId: string;
  importLogId: string;
  error: string;
}
