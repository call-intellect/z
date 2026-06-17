export type VoxLanguage = 'ru' | 'en';
export type VoxPunctuationMode = 'pro' | 'standard' | 'off';

export interface VoxSubmitOptions {
  language?: VoxLanguage;
  punctuationMode?: VoxPunctuationMode;
  diarizationEnabled?: boolean;
  speakerMode?: string;
  numSpeakers?: number;
  maxSpeakers?: number;
}

export interface VoxPollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

export interface VoxWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface VoxDiarizedSegment {
  startSec: number;
  endSec: number;
  speaker: string;
  speakerId: number;
  text: string;
}

export interface VoxResult {
  status: 'COMPLETED' | 'FAILED';
  transcriptText: string;
  durationSeconds: number;
  words?: VoxWord[];
  segments?: VoxDiarizedSegment[];
  errorMessage?: string;
}

export class VoxError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VoxError';
  }
}
