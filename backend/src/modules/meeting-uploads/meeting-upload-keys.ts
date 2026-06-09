/**
 * Конвенции S3-ключей ручной загрузки встреч (ТЗ-5 Ф2).
 *
 *   - source : `meetings/<meetingId>/upload/source.<ext>` — сырой загруженный
 *     файл (видео/аудио, ≤2 ГБ). Хранится 30 дней (retention как у записей, Р6).
 *   - audio  : `meetings/<meetingId>/upload/audio.ogg` — нормализованный аудио
 *     для Vox (mono 16к opus). Fallback при отсутствии opus-энкодера —
 *     `audio.wav` (см. `audioWavKey`).
 *
 * Видео для плеера переиспользует `compositeKey(meetingId)` из recordings/s3-keys
 * (нативный mp4 → faststart-ремукс по тому же ключу, что и живая запись).
 */

export function uploadSourceKey(meetingId: string, ext: string): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `meetings/${meetingId}/upload/source.${safeExt}`;
}

export function uploadAudioKey(meetingId: string): string {
  return `meetings/${meetingId}/upload/audio.ogg`;
}

export function uploadAudioWavKey(meetingId: string): string {
  return `meetings/${meetingId}/upload/audio.wav`;
}
