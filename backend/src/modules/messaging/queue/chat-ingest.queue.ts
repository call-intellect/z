export const CHAT_INGEST_QUEUE = 'chat.ingest';

export interface ChatIngestJobData {
  messageId: string;
}

export function chatIngestJobId(messageId: string): string {
  return `chat-ingest:${messageId}`;
}
