import { z } from 'zod';

import type { MessageDto } from './message.dto';

export const CreateConversationSchema = z
  .object({
    kind: z.enum(['dm', 'group', 'channel']),
    title: z.string().min(1).max(200).optional(),
    memberUserIds: z.array(z.string().min(1)).max(500).default([]),
  })
  .strict();
export type CreateConversationDto = z.infer<typeof CreateConversationSchema>;

export interface CreateConversationResponse {
  conversationId: string;
}

export const AddMemberSchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();
export type AddMemberDto = z.infer<typeof AddMemberSchema>;

export const VoiceSchema = z
  .object({
    url: z.string().min(1),
    duration: z.number().int().min(0).optional(),
    transcript: z.string().optional(),
  })
  .strict();

export const SendMessageSchema = z
  .object({
    content: z.string().min(1).max(20_000),
    clientMessageId: z.string().min(1).max(200),
    parentMessageId: z.string().min(1).optional(),
    access: z.enum(['normal', 'internal', 'external']).optional(),
    mentions: z.array(z.string().min(1)).max(100).optional(),
    voice: VoiceSchema.optional(),
  })
  .strict();
export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export const ListMessagesQuerySchema = z
  .object({
    sinceSeq: z.string().regex(/^\d+$/u).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
  })
  .strict();
export type ListMessagesQuery = z.infer<typeof ListMessagesQuerySchema>;

export const MarkReadSchema = z
  .object({
    cursorSeq: z.union([z.string().regex(/^\d+$/u), z.number().int().min(0)]),
  })
  .strict();
export type MarkReadDto = z.infer<typeof MarkReadSchema>;

export const ReactionSchema = z
  .object({
    emoji: z.string().min(1).max(32),
  })
  .strict();
export type ReactionDto = z.infer<typeof ReactionSchema>;

export interface SendMessageResponse {
  message: MessageDto;
  deduped: boolean;
}

export interface ListMessagesResponse {
  items: MessageDto[];
  nextSeq: string | null;
}

export interface ReactionsResponse {
  messageId: string;
  reactions: Record<string, string[]>;
}

export interface OkResponse {
  ok: true;
}
