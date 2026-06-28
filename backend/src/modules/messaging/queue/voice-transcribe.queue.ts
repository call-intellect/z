export const VOICE_TRANSCRIBE_QUEUE = 'voice.transcribe';

export interface VoiceTranscribeJobData {
  messageId: string;
}

export function voiceTranscribeJobId(messageId: string): string {
  return `voice-tx:${messageId}`;
}
