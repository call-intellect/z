import { ChatboxChatStatus } from '@prisma/client';
import { z } from 'zod';

export const ChatboxChatsListQuerySchema = z.object({
  status: z.nativeEnum(ChatboxChatStatus).optional(),
  channelType: z.string().trim().min(1).optional(),
  customerExternalId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ChatboxChatsListQueryDto = z.infer<typeof ChatboxChatsListQuerySchema>;

export const ChatboxMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});
export type ChatboxMessagesQueryDto = z.infer<typeof ChatboxMessagesQuerySchema>;

export const ChatboxSendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type ChatboxSendMessageDto = z.infer<typeof ChatboxSendMessageSchema>;

export interface ChatboxRefDto {
  externalId: string;
  name: string | null;
}

export interface MessengerIdentityDto {
  channelType: string;
  externalId: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface ChatboxSessionDto {
  id: string;
  seq: number;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  analysisStatus: string | null;
  previousSessionId: string | null;
}

export interface ChatListItemDto {
  id: string;
  externalId: string;
  channelType: string;
  status: string;
  customer: ChatboxRefDto | null;
  clientName: string | null;
  responsible: ChatboxRefDto | null;
  lastMessageAt: string | null;
  messageCount: number;
  externalCreatedAt: string | null;
}

export interface ChatDetailDto {
  id: string;
  externalId: string;
  channelType: string;
  status: string;
  customer: ChatboxRefDto | null;
  clientName: string | null;
  responsible: ChatboxRefDto | null;
  lastMessageAt: string | null;
  messageCount: number;
  externalCreatedAt: string | null;
  externalUpdatedAt: string | null;
  sessions: ChatboxSessionDto[];
  messengerIdentities: MessengerIdentityDto[];
}

export interface ChatMessageDto {
  id: string;
  externalId: string;
  senderType: string;
  senderName: string | null;
  senderPersonId: string | null;
  contentType: string;
  text: string | null;
  imageUrl: string | null;
  fileUrl: string | null;
  audioUrl: string | null;
  videoUrl: string | null;
  externalCreatedAt: string | null;
  isOutboundFromKora: boolean;
  sessionId: string | null;
}
