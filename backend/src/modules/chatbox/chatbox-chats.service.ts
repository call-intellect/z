import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import type {
  ChatboxChatsListQueryDto,
  ChatboxMessagesQueryDto,
  ChatDetailDto,
  ChatListItemDto,
  ChatMessageDto,
  MessengerIdentityDto,
} from './dto/chatbox-chats.dto';

/**
 * Сервис просмотра чатов ChatBox + исходящей отправки ответа менеджера
 * (ТЗ 2026-06-05, Фаза 6). Backend для фронта Фаз 7/8.
 *
 * Чтение — из локальных таблиц (синк Фазы 3 наполняет их). Имена
 * кастомеров/ответственных/клиентов резолвятся батчево (без N+1).
 * Отправка — через ChatBox API; локальная запись пишется ТОЛЬКО после
 * успешного ответа API (никаких «фантомных» сообщений при сетевой ошибке).
 */
@Injectable()
export class ChatboxChatsService {
  private static readonly LIST_LIMIT_DEFAULT = 30;
  private static readonly LIST_LIMIT_MAX = 100;
  private static readonly MSG_LIMIT_DEFAULT = 50;
  private static readonly MSG_LIMIT_MAX = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxApiClient) private readonly client: ChatboxApiClient,
    @Inject(ChatboxIntegrationService)
    private readonly integration: ChatboxIntegrationService,
  ) {}

  // ─────────────────────────── list ─────────────────────────────────

  async listChats(
    tenantId: string,
    q: ChatboxChatsListQueryDto,
  ): Promise<{ items: ChatListItemDto[]; total: number }> {
    const where = {
      tenantId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.channelType ? { channelType: q.channelType } : {}),
      ...(q.customerExternalId
        ? { customerExternalId: q.customerExternalId }
        : {}),
    };
    const take = clamp(
      q.limit ?? ChatboxChatsService.LIST_LIMIT_DEFAULT,
      1,
      ChatboxChatsService.LIST_LIMIT_MAX,
    );
    const skip = q.offset ?? 0;

    const [chats, total] = await Promise.all([
      this.prisma.chatboxChat.findMany({
        where,
        orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
        take,
        skip,
      }),
      this.prisma.chatboxChat.count({ where }),
    ]);

    // Батч-резолв имён (без N+1): собираем уникальные externalId-ы.
    const customerIds = uniq(
      chats.map((c) => c.customerExternalId).filter(isStr),
    );
    const memberIds = uniq(
      chats.map((c) => c.responsibleExternalId).filter(isStr),
    );
    const clientIds = uniq(chats.map((c) => c.clientExternalId).filter(isStr));

    const [customers, members, clients] = await Promise.all([
      customerIds.length
        ? this.prisma.chatboxCustomer.findMany({
            where: { tenantId, externalId: { in: customerIds } },
            select: { externalId: true, name: true },
          })
        : Promise.resolve([]),
      memberIds.length
        ? this.prisma.chatboxMember.findMany({
            where: { tenantId, externalId: { in: memberIds } },
            select: { externalId: true, name: true },
          })
        : Promise.resolve([]),
      clientIds.length
        ? this.prisma.chatboxChannelClient.findMany({
            where: { tenantId, externalId: { in: clientIds } },
            select: { externalId: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const customerMap = toNameMap(customers);
    const memberMap = toNameMap(members);
    const clientMap = toNameMap(clients);

    const items: ChatListItemDto[] = chats.map((c) => ({
      id: c.id,
      externalId: c.externalId,
      channelType: c.channelType,
      status: c.status,
      customer: c.customerExternalId
        ? {
            externalId: c.customerExternalId,
            name: customerMap.get(c.customerExternalId) ?? null,
          }
        : null,
      clientName: c.clientExternalId
        ? (clientMap.get(c.clientExternalId) ?? null)
        : null,
      responsible: c.responsibleExternalId
        ? {
            externalId: c.responsibleExternalId,
            name: memberMap.get(c.responsibleExternalId) ?? null,
          }
        : null,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      messageCount: c.messageCount,
      externalCreatedAt: c.externalCreatedAt?.toISOString() ?? null,
    }));

    return { items, total };
  }

  // ─────────────────────────── detail ───────────────────────────────

  async getChat(tenantId: string, chatDbId: string): Promise<ChatDetailDto> {
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: chatDbId, tenantId },
    });
    if (!chat) throw this.chatNotFound();

    const [customer, responsible, sessions, identities, client] =
      await Promise.all([
        chat.customerExternalId
          ? this.prisma.chatboxCustomer.findFirst({
              where: { tenantId, externalId: chat.customerExternalId },
              select: { externalId: true, name: true },
            })
          : Promise.resolve(null),
        chat.responsibleExternalId
          ? this.prisma.chatboxMember.findFirst({
              where: { tenantId, externalId: chat.responsibleExternalId },
              select: { externalId: true, name: true, linkedPersonId: true },
            })
          : Promise.resolve(null),
        this.prisma.chatboxChatSession.findMany({
          where: { tenantId, chatId: chatDbId },
          orderBy: { seq: 'asc' },
          select: {
            id: true,
            seq: true,
            startedAt: true,
            endedAt: true,
            summary: true,
            analysisStatus: true,
            previousSessionId: true,
          },
        }),
        // messengerIdentities: все клиентские identity того же кастомера.
        chat.customerExternalId
          ? this.prisma.chatboxChannelClient.findMany({
              where: { tenantId, customerExternalId: chat.customerExternalId },
              select: {
                channelType: true,
                externalId: true,
                name: true,
                avatarUrl: true,
              },
            })
          : Promise.resolve([]),
        chat.clientExternalId
          ? this.prisma.chatboxChannelClient.findFirst({
              where: { tenantId, externalId: chat.clientExternalId },
              select: { name: true },
            })
          : Promise.resolve(null),
      ]);

    const messengerIdentities: MessengerIdentityDto[] = identities.map((i) => ({
      channelType: i.channelType,
      externalId: i.externalId,
      name: i.name ?? null,
      avatarUrl: i.avatarUrl ?? null,
    }));

    return {
      id: chat.id,
      externalId: chat.externalId,
      channelType: chat.channelType,
      status: chat.status,
      customer: customer
        ? { externalId: customer.externalId, name: customer.name ?? null }
        : null,
      clientName: client?.name ?? null,
      responsible: responsible
        ? {
            externalId: responsible.externalId,
            name: responsible.name ?? null,
          }
        : null,
      lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
      messageCount: chat.messageCount,
      externalCreatedAt: chat.externalCreatedAt?.toISOString() ?? null,
      externalUpdatedAt: chat.externalUpdatedAt?.toISOString() ?? null,
      sessions: sessions.map((s) => ({
        id: s.id,
        seq: s.seq,
        startedAt: s.startedAt?.toISOString() ?? null,
        endedAt: s.endedAt?.toISOString() ?? null,
        summary: s.summary ?? null,
        analysisStatus: s.analysisStatus ?? null,
        previousSessionId: s.previousSessionId ?? null,
      })),
      messengerIdentities,
    };
  }

  // ─────────────────────────── messages ─────────────────────────────

  async listMessages(
    tenantId: string,
    chatDbId: string,
    q: ChatboxMessagesQueryDto,
  ): Promise<{ items: ChatMessageDto[]; total: number }> {
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: chatDbId, tenantId },
      select: { id: true },
    });
    if (!chat) throw this.chatNotFound();

    const take = clamp(
      q.limit ?? ChatboxChatsService.MSG_LIMIT_DEFAULT,
      1,
      ChatboxChatsService.MSG_LIMIT_MAX,
    );
    const skip = q.offset ?? 0;
    const where = { tenantId, chatId: chatDbId };

    const [messages, total] = await Promise.all([
      this.prisma.chatboxMessage.findMany({
        where,
        orderBy: { externalCreatedAt: 'asc' },
        take,
        skip,
      }),
      this.prisma.chatboxMessage.count({ where }),
    ]);

    const items: ChatMessageDto[] = messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName ?? null,
      contentType: m.contentType,
      text: m.text ?? null,
      imageUrl: m.imageUrl ?? null,
      fileUrl: m.fileUrl ?? null,
      audioUrl: m.audioUrl ?? null,
      videoUrl: m.videoUrl ?? null,
      externalCreatedAt: m.externalCreatedAt?.toISOString() ?? null,
      isOutboundFromKora: m.isOutboundFromKora,
      sessionId: m.sessionId ?? null,
    }));

    return { items, total };
  }

  // ─────────────────────────── send ─────────────────────────────────

  async sendMessage(
    tenantId: string,
    chatDbId: string,
    text: string,
  ): Promise<{ id: string }> {
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: chatDbId, tenantId },
    });
    if (!chat) throw this.chatNotFound();

    const cfg = await this.integration.getConfigForSync(tenantId);
    if (!cfg) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_not_configured',
          message: 'Интеграция с ChatBox не настроена',
        },
      });
    }

    // Сетевой вызов ПЕРВЫМ. На любую ошибку — НЕ пишем в БД.
    let apiMsg;
    try {
      apiMsg = await this.client.sendMessage(
        cfg.token,
        cfg.workspaceId,
        chat.externalId,
        { text },
      );
    } catch {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_send_failed',
          message: 'Не удалось отправить сообщение в ChatBox',
        },
      });
    }

    const createdAt = new Date(apiMsg.createdAt);

    // messageCount инкрементим только если сообщение реально новое — иначе при
    // гонке с синком/вебхуком (upsert пошёл по update) счётчик завышается.
    const existing = await this.prisma.chatboxMessage.findUnique({
      where: { tenantId_externalId: { tenantId, externalId: apiMsg.id } },
      select: { id: true },
    });
    const isNewMessage = existing === null;

    await this.prisma.chatboxMessage.upsert({
      where: {
        tenantId_externalId: { tenantId, externalId: apiMsg.id },
      },
      create: {
        tenantId,
        chatId: chatDbId,
        externalId: apiMsg.id,
        senderType: 'USER',
        senderName: apiMsg.sender?.name ?? null,
        senderExternalId: apiMsg.sender?.id ?? null,
        contentType: 'TEXT',
        text,
        externalCreatedAt: createdAt,
        isOutboundFromKora: true,
      },
      update: {
        chatId: chatDbId,
        senderType: 'USER',
        senderName: apiMsg.sender?.name ?? null,
        senderExternalId: apiMsg.sender?.id ?? null,
        contentType: 'TEXT',
        text,
        externalCreatedAt: createdAt,
        isOutboundFromKora: true,
      },
    });

    const nextLastMessageAt =
      chat.lastMessageAt && chat.lastMessageAt > createdAt
        ? chat.lastMessageAt
        : createdAt;

    await this.prisma.chatboxChat.update({
      where: { id: chatDbId },
      data: {
        lastMessageAt: nextLastMessageAt,
        ...(isNewMessage ? { messageCount: { increment: 1 } } : {}),
      },
    });

    return { id: apiMsg.id };
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private chatNotFound(): BadRequestException {
    return new BadRequestException({
      ok: false,
      error: { code: 'chatbox_chat_not_found', message: 'Чат не найден' },
    });
  }
}

// ─────────────────────────── pure helpers ───────────────────────────

function isStr(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.length > 0;
}

function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function toNameMap(
  rows: ReadonlyArray<{ externalId: string; name: string | null }>,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const r of rows) map.set(r.externalId, r.name ?? null);
  return map;
}
