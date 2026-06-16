import type { JobsOptions } from 'bullmq';

export const MEETING_UPLOAD_QUEUE_NAMES = {
  UPLOAD_INGEST: 'meeting.upload-ingest',
  UPLOAD_TRANSCRIBE: 'meeting.upload-transcribe',
} as const;

export type MeetingUploadQueueName =
  (typeof MEETING_UPLOAD_QUEUE_NAMES)[keyof typeof MEETING_UPLOAD_QUEUE_NAMES];

export const MEETING_UPLOAD_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

export interface MeetingUploadJobData {
  meetingId: string;
}
