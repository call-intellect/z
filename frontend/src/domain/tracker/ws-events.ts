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
  | 'activity_feed.new_item';
