import type { JobsOptions } from 'bullmq';

/**
 * Имена BullMQ-очередей ручной загрузки встреч (ТЗ-5 meeting-upload-diarization).
 *
 * Префикс `meeting.` отделяет от `ai.*` (живой per-track конвейер) и `core.*`
 * (knowledge-core). Загрузка — отдельная «голова» конвейера, сходящаяся с
 * существующим analyze-хвостом только после подписи говорящих (`/speakers/confirm`).
 *
 *   - `meeting.upload-ingest`     (Ф2) — ffprobe → нормализация аудио (mono 16к
 *     ogg/opus) + faststart нативного видео; `Recording(ready)`; FSM до
 *     `recording_ready`; enqueue upload-transcribe. Consumer —
 *     `MeetingUploadIngestWorker` (concurrency=1, ffmpeg тяжёлый).
 *   - `meeting.upload-transcribe` (Ф3) — Vox(diarization) → `Transcript.turns`
 *     + `MeetingUploadSpeaker[]`; FSM до `awaiting_speakers`; анализ НЕ ставит.
 *     **Здесь (Ф2) определяется только очередь+enqueue; сам воркер — Ф3.**
 */
export const MEETING_UPLOAD_QUEUE_NAMES = {
  UPLOAD_INGEST: 'meeting.upload-ingest',
  UPLOAD_TRANSCRIBE: 'meeting.upload-transcribe',
} as const;

export type MeetingUploadQueueName =
  (typeof MEETING_UPLOAD_QUEUE_NAMES)[keyof typeof MEETING_UPLOAD_QUEUE_NAMES];

/**
 * Дефолтные опции job'ов загрузки. Те же 5 попыток, что и у AI-pipeline,
 * но backoff длиннее (15s) — ingest качает большой файл из S3 и гоняет
 * ffmpeg; частить ретраи нет смысла. `removeOnFail: false` — failed остаются
 * для разбора.
 */
export const MEETING_UPLOAD_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { age: 86400, count: 1000 },
  removeOnFail: false,
};

/**
 * Payload обеих очередей загрузки. Минимальный — только `meetingId`; воркер
 * сам подтянет `Meeting`/`Recording`/`Transcript` из БД (тонкий payload).
 */
export interface MeetingUploadJobData {
  meetingId: string;
}
