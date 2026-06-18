import { MeetingType } from '@prisma/client';
import { z } from 'zod';

export const UPLOAD_MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

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
  sizeBytes: z.number().int().positive().max(UPLOAD_MAX_SIZE_BYTES),
  numSpeakersHint: z.number().int().min(1).max(20).nullish(),
});
export type UploadCreateDto = z.infer<typeof UploadCreateSchema>;

export interface UploadCreateResultDto {
  meetingId: string;
  uploadUrl: string;
  uploadKey: string;
  expiresAt: string;
}

export interface UploadCompleteResultDto {
  status: string;
}

export interface UploadPlaybackResultDto {
  kind: 'video' | 'audio';
  url: string;
  expiresAt: string;
}

export const UPLOAD_SPEAKER_ASSIGNMENTS = [
  'unassigned',
  'employee',
  'external',
  'excluded',
  'merged',
] as const;

export const SpeakerAssignmentSchema = z.object({
  label: z.string().min(1).max(120),
  assignment: z.enum(UPLOAD_SPEAKER_ASSIGNMENTS),
  personId: z.string().min(1).max(60).nullish(),
  externalName: z.string().min(1).max(200).nullish(),
  externalCompany: z.string().max(200).nullish(),
  externalPosition: z.string().max(200).nullish(),
  mergedIntoLabel: z.string().min(1).max(120).nullish(),
});
export type SpeakerAssignmentDto = z.infer<typeof SpeakerAssignmentSchema>;

export const SpeakerAssignmentsSchema = z.object({
  assignments: z.array(SpeakerAssignmentSchema).min(1).max(50),
});
export type SpeakerAssignmentsDto = z.infer<typeof SpeakerAssignmentsSchema>;

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

export interface TranscriptTurnDto {
  speaker: string;
  text: string;
  startSec: number;
  endSec: number;
  speakerParticipantId: string | null;
  speakerLivekitIdentity: string | null;
}

export interface UploadSpeakersResultDto {
  speakers: UploadSpeakerDto[];
  turns: TranscriptTurnDto[];
}

export interface UploadSpeakersDraftResultDto {
  speakers: UploadSpeakerDto[];
}

export interface UploadSpeakersConfirmResultDto {
  status: string;
}
