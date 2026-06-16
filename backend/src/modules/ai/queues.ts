import type { JobsOptions } from 'bullmq';

export const QUEUE_NAMES = {
  TRANSCRIBE: 'ai.transcribe',
  MERGE: 'ai.merge',
  ANALYZE: 'ai.analyze',
  NOTIFY: 'ai.notify',
  EMBEDDINGS: 'ai.embeddings',
  CLIP_RENDER: 'clip.render',
  CARD_ROLLUP: 'ai.card-rollup',
  BEHAVIOR_METRICS: 'ai.behavior-metrics',
  TRANSCRIPT_CLEAN: 'ai.transcript-clean',
  CUSTOM_REPORT: 'ai.custom-report',
  RECORDING_FASTSTART: 'recording.faststart',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 8000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

export interface AiJobData {
  meetingId: string;
  attempt: number;
  templateId?: string;
}

export interface ClipRenderJobData {
  highlightId: string;
  attempt: number;
}

export interface CardRollupJobData {
  cardId: string;
  reason?: 'analyze' | 'regenerate' | 'link' | 'unlink' | 'manual';
}

export interface CustomReportJobData {
  meetingReportId: string;
  meetingId: string;
  reason: 'create' | 'regenerate';
  attempt: number;
}
