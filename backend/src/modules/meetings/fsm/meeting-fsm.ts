import type { MeetingStatus } from '@prisma/client';

import { InvalidFsmTransitionError } from '../../../common/errors/domain-errors';

export const ALLOWED_TRANSITIONS: Readonly<Record<MeetingStatus, readonly MeetingStatus[]>> = {
  scheduled: ['active', 'recording_processing', 'failed'],
  active: ['completed', 'failed'],
  completed: ['recording_processing', 'transcription_processing', 'failed'],
  recording_processing: ['recording_ready', 'failed'],
  recording_ready: ['transcription_processing', 'failed', 'ai_failed'],
  transcription_processing: ['transcription_ready', 'awaiting_speakers', 'failed', 'ai_failed'],
  transcription_ready: ['ai_processing', 'failed', 'ai_failed'],
  awaiting_speakers: ['ai_processing', 'failed', 'ai_failed'],
  ai_processing: ['ai_ready', 'failed', 'ai_failed'],
  ai_ready: ['ai_failed'],
  failed: [],
  ai_failed: [],
};

export function assertTransition(from: MeetingStatus, to: MeetingStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidFsmTransitionError(from, to);
  }
}

export function isTransitionAllowed(from: MeetingStatus, to: MeetingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
