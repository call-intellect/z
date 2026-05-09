/**
 * S3-ключи для AI-pipeline артефактов.
 *
 *   - `meetings/<meetingId>/transcripts/track_<id>.json` — per-track Vox-результат.
 *   - `meetings/<meetingId>/transcripts/index.json`     — индекс ссылок per-track.
 *   - `meetings/<meetingId>/transcripts/merged.json`    — итоговый dialog.
 *
 * Запись напрямую через S3 PutObject (не через Egress, в отличие от audio).
 */

export function transcriptTrackKey(
  meetingId: string,
  participantIdentity: string,
): string {
  return `meetings/${meetingId}/transcripts/track_${sanitize(participantIdentity)}.json`;
}

export function transcriptIndexKey(meetingId: string): string {
  return `meetings/${meetingId}/transcripts/index.json`;
}

export function transcriptMergedKey(meetingId: string): string {
  return `meetings/${meetingId}/transcripts/merged.json`;
}

/**
 * Структура index.json — массив ссылок на per-track jsons + метаданные.
 */
export interface TranscriptIndex {
  meetingId: string;
  tracks: Array<{
    participantId: string | null;
    livekitIdentity: string;
    speakerName: string;
    s3Key: string;
    /** ISO-8601. */
    trackStartedAt: string;
    /** ISO-8601. Базовая точка времени встречи (минимум по всем трекам). */
    baseStartedAt: string;
  }>;
  generatedAt: string;
}

function sanitize(identity: string): string {
  // host:abc / guest:xyz — `:` валиден для S3, но в имени файла лучше
  // заменить, чтобы не путаться с локальными ОС.
  return identity.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
