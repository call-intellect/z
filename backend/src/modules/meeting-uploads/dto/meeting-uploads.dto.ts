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

// ─────────────────── Разметка спикеров (ТЗ-5 Ф4) ────────────────────────────

/**
 * Тип назначения метки говорящего (зеркало enum `UploadSpeakerAssignment`):
 *   - `unassigned` — ещё не размечен (черновик, нельзя подтвердить);
 *   - `employee`   — сотрудник компании (привязка к существующему Person);
 *   - `external`   — внешний участник (имя/компания/должность → find-or-create Person);
 *   - `excluded`   — исключить из анализа (turn'ы метки вырезаются);
 *   - `merged`     — слить с другой меткой (см. `mergedIntoLabel`); наследует
 *                    назначение целевой метки.
 */
export const UPLOAD_SPEAKER_ASSIGNMENTS = [
  'unassigned',
  'employee',
  'external',
  'excluded',
  'merged',
] as const;

/**
 * Один ряд назначения метки говорящего в `PUT`-черновике / `confirm`.
 * Контракт ТЗ-5 Ф4. Поля валидируются перекрёстно в сервисе (employee →
 * нужен personId; external → externalName; merged → mergedIntoLabel).
 */
export const SpeakerAssignmentSchema = z.object({
  /** Машинная метка диаризации (`"SPEAKER N"`). */
  label: z.string().min(1).max(120),
  assignment: z.enum(UPLOAD_SPEAKER_ASSIGNMENTS),
  /** employee → id существующего Person этой Org. */
  personId: z.string().min(1).max(60).nullish(),
  /** external → имя контакта (обязательно при assignment=external). */
  externalName: z.string().min(1).max(200).nullish(),
  externalCompany: z.string().max(200).nullish(),
  externalPosition: z.string().max(200).nullish(),
  /** merged → метка-цель, в которую сливается этот говорящий. */
  mergedIntoLabel: z.string().min(1).max(120).nullish(),
});
export type SpeakerAssignmentDto = z.infer<typeof SpeakerAssignmentSchema>;

/** Тело `PUT /meetings/:id/speakers` — массив назначений (черновик). */
export const SpeakerAssignmentsSchema = z.object({
  assignments: z.array(SpeakerAssignmentSchema).min(1).max(50),
});
export type SpeakerAssignmentsDto = z.infer<typeof SpeakerAssignmentsSchema>;

/** Ряд говорящего в ответе `GET`/`PUT /meetings/:id/speakers`. */
export interface UploadSpeakerDto {
  label: string;
  displayLabel: string;
  turnsCount: number;
  speakingSeconds: number;
  sampleText: string;
  assignment: (typeof UPLOAD_SPEAKER_ASSIGNMENTS)[number];
  personId: string | null;
  externalName: string | null;
  externalCompany: string | null;
  externalPosition: string | null;
  mergedIntoLabel: string | null;
  participantId: string | null;
}

/** Реплика транскрипта в ответе `GET /meetings/:id/speakers`. */
export interface TranscriptTurnDto {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  speakerParticipantId: string | null;
  speakerLivekitIdentity: string | null;
}

/** Ответ `GET /meetings/:id/speakers`. */
export interface UploadSpeakersResultDto {
  speakers: UploadSpeakerDto[];
  turns: TranscriptTurnDto[];
}

/** Ответ `PUT /meetings/:id/speakers`. */
export interface UploadSpeakersDraftResultDto {
  speakers: UploadSpeakerDto[];
}

/** Ответ `POST /meetings/:id/speakers/confirm`. */
export interface UploadSpeakersConfirmResultDto {
  status: string;
}
