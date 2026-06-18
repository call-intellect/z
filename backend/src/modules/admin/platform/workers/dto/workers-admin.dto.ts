export interface QueueSummaryItemDto {
  name: string;
  counts: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
    paused: number;
  };
  isPaused: boolean;
}

export interface QueueFailedJobDto {
  id: string;
  name: string;
  failedReason: string | null;
  timestamp: number | null;
  attemptsMade: number;
  stacktraceExcerpt: string | null;
}

export interface QueueCompletedJobDto {
  id: string;
  name: string;
  finishedOn: number | null;
  processedOn: number | null;
  durationMs: number | null;
}

export interface QueueDetailDto {
  name: string;
  counts: QueueSummaryItemDto['counts'];
  isPaused: boolean;
  recentFailed: QueueFailedJobDto[];
  recentCompleted: QueueCompletedJobDto[];
  processingRatePerHour: number | null;
}
