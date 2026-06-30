export const MESSAGE_OUTBOX_QUEUE = 'message.outbox';

export interface MessageOutboxJobData {
  messageId: string;
}

export function outboxJobId(messageId: string): string {
  return `msg-outbox:${messageId}`;
}
