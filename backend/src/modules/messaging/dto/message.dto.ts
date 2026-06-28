import type { Prisma } from '@prisma/client';

export type MessageAccess = 'normal' | 'internal' | 'external';

export interface MessageDto {
  id: string;
  conversationId: string;
  seq: string;
  authorUserId: string;
  authorType: string;
  access: string;
  content: string;
  parentMessageId: string | null;
  voiceUrl: string | null;
  voiceDuration: number | null;
  mentions: string[];
  reactions: Prisma.JsonValue | null;
  createdAt: string;
  editedAt: string | null;
}

export interface SendMessageResult {
  message: MessageDto;
  deduped: boolean;
}

export interface GetMessagesResult {
  items: MessageDto[];
  nextSeq: string | null;
}
