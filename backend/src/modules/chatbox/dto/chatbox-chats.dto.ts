import { ChatboxChatStatus } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO просмотра чатов ChatBox + исходящей отправки ответа менеджера
 * (ТЗ 2026-06-05, Фаза 6).
 *
 * Запросы — Zod-валидация через ZodValidationPipe. Ответы — интерфейсы
 * для фронта (Фазы 7/8): list/detail/messages + идентичности по мессенджерам.
 *
 * Privacy R12: чтение переписки доступно только участникам организации
 * (гейт в контроллере), не «чистому» super_admin.
 */

// ─────────────────────────── запросы ────────────────────────────────────

/** Query `GET /chatbox/chats` — фильтры + пагинация. */
export const ChatboxChatsListQuerySchema = z.object({
  status: z.nativeEnum(ChatboxChatStatus).optional(),
  channelType: z.string().trim().min(1).optional(),
  customerExternalId: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ChatboxChatsListQueryDto = z.infer<
  typeof ChatboxChatsListQuerySchema
>;

/** Query `GET /chatbox/chats/:id/messages` — пагинация. */
export const ChatboxMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  // Порядок выдачи. 'desc' — для Telegram-style: грузим последние N, затем older
  // по offset вверх. Default 'asc' (старые→новые) — обратная совместимость.
  order: z.enum(['asc', 'desc']).optional(),
});
export type ChatboxMessagesQueryDto = z.infer<
  typeof ChatboxMessagesQuerySchema
>;

/** Тело `POST /chatbox/chats/:id/messages` — отправка ответа менеджера. */
export const ChatboxSendMessageSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type ChatboxSendMessageDto = z.infer<typeof ChatboxSendMessageSchema>;

// ─────────────────────────── ответы ─────────────────────────────────────

/** Краткая ссылка на кастомера/ответственного в DTO. */
export interface ChatboxRefDto {
  externalId: string;
  name: string | null;
}

/** Идентичность клиента в конкретном мессенджере (для мультимессенджер-бейджей). */
export interface MessengerIdentityDto {
  channelType: string;
  externalId: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Сессия чата (под-тред разговора). */
export interface ChatboxSessionDto {
  id: string;
  seq: number;
  startedAt: string | null;
  endedAt: string | null;
  summary: string | null;
  analysisStatus: string | null;
  previousSessionId: string | null;
}

/** Элемент списка чатов. */
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

/** Детали чата. */
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

/** Сообщение чата. */
export interface ChatMessageDto {
  id: string;
  senderType: string;
  senderName: string | null;
  /** Person Коры, связанный с отправителем-менеджером (ссылка на профиль). null — нет связки/клиент. */
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
