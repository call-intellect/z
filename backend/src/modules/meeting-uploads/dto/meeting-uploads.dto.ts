import { MeetingType } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO ручной загрузки встреч (ТЗ-5 Ф2). Zod-DTO (`nestjs-zod`) — единый источник
 * правды о форме запроса; контроллер валидирует через `ZodValidationPipe`.
 */

/** Лимит размера файла — 2 ГБ (решение владельца Р4). */
export const UPLOAD_MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Разрешённые расширения. ffmpeg декодирует практически любой контейнер, но
 * валидируем расширение на входе, чтобы заранее отсечь явный мусор (документы,
 * архивы) до создания Meeting и presigned-PUT. UI-валидация (`accept`) этот
 * список дублирует — серверная проверка первична.
 */
export const UPLOAD_VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
  'wmv',
  'flv',
  '3gp',
  'mpeg',
  'mpg',
  'ts',
] as const;

export const UPLOAD_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'ogg',
  'oga',
  'opus',
  'flac',
  'amr',
  'wma',
] as const;

export const UPLOAD_ALLOWED_EXTENSIONS: readonly string[] = [
  ...UPLOAD_VIDEO_EXTENSIONS,
  ...UPLOAD_AUDIO_EXTENSIONS,
];

/** Достаёт нижнерегистровое расширение из имени файла (без точки). */
export function fileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  if (idx < 0 || idx === fileName.length - 1) return '';
  return fileName.slice(idx + 1).toLowerCase();
}

export const UploadCreateSchema = z.object({
  type: z.nativeEnum(MeetingType),
  title: z.string().min(1).max(200),
  customPrompt: z.string().max(10_000).nullish(),
  fileName: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120),
  /** Р4 — ≤ 2 ГБ. Превышение → 400 `UPLOAD_FILE_TOO_LARGE` (см. контроллер). */
  sizeBytes: z.number().int().positive().max(UPLOAD_MAX_SIZE_BYTES),
  /** Подсказка числа говорящих для Vox (Ф3). NULL/отсутствует = авто. */
  numSpeakersHint: z.number().int().min(1).max(20).nullish(),
});
export type UploadCreateDto = z.infer<typeof UploadCreateSchema>;

/** Ответ `POST /meetings/upload`. */
export interface UploadCreateResultDto {
  meetingId: string;
  uploadUrl: string;
  uploadKey: string;
  expiresAt: string;
}

/** Ответ `POST /meetings/:id/upload/complete`. */
export interface UploadCompleteResultDto {
  status: string;
}

/** Ответ `GET /meetings/:id/upload/playback`. */
export interface UploadPlaybackResultDto {
  kind: 'video' | 'audio';
  url: string;
  expiresAt: string;
}
