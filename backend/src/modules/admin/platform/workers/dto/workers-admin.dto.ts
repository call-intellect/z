/**
 * Admin-redesign Фаза 8 — DTO для `WorkersAdminController`.
 *
 * UI `/admin/platform/workers` показывает BullMQ-inspector: список очередей,
 * counts, последние failed/completed, действия pause/resume/retry/delete.
 *
 * Все имена очередей берутся из объединённого статического списка
 * `QUEUE_NAMES + CORE_QUEUE_NAMES + TRACKER_QUEUE_NAMES`. Динамического
 * обнаружения нет (см. AdminIncidentsService — то же решение).
 */

// ───────────────────────────── responses ─────────────────────────────────

export interface QueueSummaryItemDto {
  /** Имя очереди (например `ai.transcribe`). */
  name: string;
  /** Счётчики по состояниям. */
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  /** Статус паузы (true → очередь приостановлена через Queue.pause()). */
  isPaused: boolean;
}

export interface QueueFailedJobDto {
  id: string;
  name: string;
  failedReason: string | null;
  /** Unix timestamp ms (когда job попал в обработку). */
  timestamp: number | null;
  attemptsMade: number;
  /** Краткий excerpt stacktrace для UI (до 800 символов). */
  stacktraceExcerpt: string | null;
}

export interface QueueCompletedJobDto {
  id: string;
  name: string;
  /** ISO ms когда завершился. */
  finishedOn: number | null;
  /** ISO ms когда начат. */
  processedOn: number | null;
  /** Длительность обработки (если можно посчитать). */
  durationMs: number | null;
}

export interface QueueDetailDto {
  name: string;
  counts: QueueSummaryItemDto['counts'];
  isPaused: boolean;
  /** Последние 20 failed jobs. */
  recentFailed: QueueFailedJobDto[];
  /** Последние 10 completed jobs. */
  recentCompleted: QueueCompletedJobDto[];
  /**
   * Processing rate: число completed за последний час из выборки
   * `recentCompleted` (грубая оценка). null — если нельзя посчитать
   * (нет finishedOn у jobs).
   */
  processingRatePerHour: number | null;
}
