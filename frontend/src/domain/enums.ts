// Domain enums — продублированы из Prisma schema (backend).
// Любое изменение синхронизировать с backend/prisma/schema.prisma.

export const MEETING_TYPES = [
  'team',
  'standup',
  'plan_fact',
  'project',
  'sales',
  'custdev',
  'partner',
  'interview',
  'customer_success',
] as const;
export type MeetingType = typeof MEETING_TYPES[number];

export const MEETING_STATUSES = [
  'scheduled',
  'active',
  'completed',
  'recording_processing',
  'recording_ready',
  'transcription_processing',
  'transcription_ready',
  'ai_processing',
  'ai_ready',
  'failed',
] as const;
export type MeetingStatus = typeof MEETING_STATUSES[number];

export type ParticipantRole = 'host' | 'guest';
export type UserRole = 'user' | 'admin';

export const RECORDING_STATUSES = [
  'idle',
  'recording',
  'finalizing',
  'ready',
  'failed',
] as const;
export type RecordingStatus = typeof RECORDING_STATUSES[number];
