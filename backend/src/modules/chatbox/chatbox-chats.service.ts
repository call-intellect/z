import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';
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
  private readonly logger = new Logger(ChatboxChatsService.name);
  private static readonly LIST_LIMIT_DEFAULT = 30;
  private static readonly LIST_LIMIT_MAX = 100;
  private static readonly MSG_LIMIT_DEFAULT = 50;
  private static readonly MSG_LIMIT_MAX = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxApiClient) private readonly client: ChatboxApiClient,
    @Inject(ChatboxIntegrationService)
    private readonly integration: ChatboxIntegrationService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly analyzeQueue: ChatboxAnalyzeQueueService,
  ) {}

  /**
   * Ручной запуск AI-анализа по чату: ставит в очередь все закрытые сессии
   * этого чата со статусом `pending`. Явное действие владельца — поэтому НЕ
   * гейтится `analysisEnabled` (тумблер гейтит только авто-крон).
   */
  async analyzeChat(
    tenantId: string,
    chatDbId: string,
  ): Promise<{ enqueued: number }> {
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: chatDbId, tenantId },
      select: { id: true },
    });
    if (!chat) throw this.chatNotFound();

    const sessions = await this.prisma.chatboxChatSession.findMany({
      where: {
        tenantId,
        chatId: chatDbId,
        analysisStatus: 'pending',
        endedAt: { not: null },
      },
      select: { id: true },
    });

    let enqueued = 0;
    for (const s of sessions) {
      try {
        await this.analyzeQueue.enqueue(tenantId, s.id);
        enqueued += 1;
      } catch (err) {
        this.logger.warn(
          { sessionId: s.id, err: err instanceof Error ? err.message : String(err) },
          'analyzeChat: не удалось поставить job — пропуск',
        );
      }
    }
    return { enqueued };
  }

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
        orderBy: { externalCreatedAt: q.order === 'desc' ? 'desc' : 'asc' },
        take,
        skip,
      }),
      this.prisma.chatboxMessage.count({ where }),
    ]);

    // Резолв отправителей-менеджеров → Person Коры (кликабельный профиль).
    // CLIENT не резолвим — у клиентов нет профиля-страницы. Батч, без N+1.
    const managerExtIds = [
      ...new Set(
        messages
          .filter((m) => m.senderType !== 'CLIENT' && m.senderExternalId)
          .map((m) => m.senderExternalId as string),
      ),
    ];
    const personByExtId = new Map<string, string>();
    if (managerExtIds.length > 0) {
      const members = await this.prisma.chatboxMember.findMany({
        where: {
          tenantId,
          externalId: { in: managerExtIds },
          linkedPersonId: { not: null },
        },
        select: { externalId: true, linkedPersonId: true },
      });
      for (const mem of members) {
        if (mem.linkedPersonId)
          personByExtId.set(mem.externalId, mem.linkedPersonId);
      }
    }

    const items: ChatMessageDto[] = messages.map((m) => ({
      id: m.id,
      senderType: m.senderType,
      senderName: m.senderName ?? null,
      senderPersonId:
        m.senderType !== 'CLIENT' && m.senderExternalId
          ? (personByExtId.get(m.senderExternalId) ?? null)
          : null,
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

    // ChatBox может вернуть сообщение как есть либо в обёртке {message|data|
    // result}. Извлекаем id/createdAt/sender best-effort (форма ответа POST
    // ещё не зафиксирована боевой отправкой). Если id нет — синтетический ключ,
    // чтобы не падать 500 и показать отправленное сразу (реальное доедет
    // синком). Лог формы — чтобы зафиксировать реальную форму ответа POST.
    const parsed = extractChatboxOutboundId(apiMsg);

    if (parsed.id === null) {
      this.logger.warn(
        {
          keys:
            apiMsg && typeof apiMsg === 'object'
              ? Object.keys(apiMsg as object)
              : typeof apiMsg,
        },
        'chatbox sendMessage: ответ ChatBox без message id — сохраняю по синтетическому ключу',
      );
    }
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt) : new Date();
    const externalId =
      parsed.id ??
      `kora-out-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

    // messageCount инкрементим только если сообщение реально новое — иначе при
    // гонке с синком/вебхуком (upsert пошёл по update) счётчик завышается.
    const existing = await this.prisma.chatboxMessage.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
      select: { id: true },
    });
    const isNewMessage = existing === null;

    await this.prisma.chatboxMessage.upsert({
      where: {
        tenantId_externalId: { tenantId, externalId },
      },
      create: {
        tenantId,
        chatId: chatDbId,
        externalId,
        senderType: 'USER',
        senderName: parsed.senderName,
        senderExternalId: parsed.senderId,
        contentType: 'TEXT',
        text,
        externalCreatedAt: createdAt,
        isOutboundFromKora: true,
      },
      update: {
        chatId: chatDbId,
        senderType: 'USER',
        senderName: parsed.senderName,
        senderExternalId: parsed.senderId,
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

    return { id: externalId };
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

/** Результат разбора ответа ChatBox на POST-отправку сообщения. */
export interface ChatboxOutboundParsed {
  id: string | null;
  createdAt: string | null;
  senderId: string | null;
  senderName: string | null;
}

/** id-кандидаты по приоритету (берём первый непустой → String()). */
const OUTBOUND_ID_KEYS = [
  'id',
  'messageId',
  'message_id',
  'externalId',
  'external_id',
  '_id',
] as const;
/** Кандидаты на дату создания. */
const OUTBOUND_CREATED_KEYS = ['createdAt', 'created_at', 'timestamp'] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/** Первый непустой scalar (строка/число) из record по списку ключей → String(). */
function firstScalar(
  rec: Record<string, unknown> | null,
  keys: readonly string[],
): string | null {
  if (!rec) return null;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

/**
 * Best-effort извлечение id отправленного сообщения из ответа ChatBox на POST.
 *
 * Форма ответа боевой отправки ещё не зафиксирована, поэтому пробуем id-ключи
 * по приоритету и в самом `raw`, и во вложенных обёртках `message`/`data`/
 * `result`. createdAt и sender — тем же best-effort. Чистая функция (без
 * сети/Prisma) — экспортируется ради юнит-теста.
 *
 * @returns `{ id, createdAt, senderId, senderName }`; любое поле = null, если
 *          его не нашли (вызывающий код подставит синтетический ключ).
 */
export function extractChatboxOutboundId(raw: unknown): ChatboxOutboundParsed {
  const root = asRecord(raw);
  // Кандидаты-контейнеры: сам объект + типовые обёртки.
  const containers: Array<Record<string, unknown> | null> = [
    root,
    asRecord(root?.message),
    asRecord(root?.data),
    asRecord(root?.result),
  ];

  let id: string | null = null;
  let createdAt: string | null = null;
  let senderId: string | null = null;
  let senderName: string | null = null;

  for (const c of containers) {
    if (!c) continue;
    id ??= firstScalar(c, OUTBOUND_ID_KEYS);
    createdAt ??= firstScalar(c, OUTBOUND_CREATED_KEYS);
    const sender = asRecord(c.sender) ?? asRecord(c.from);
    if (sender) {
      senderId ??= firstScalar(sender, ['id']);
      senderName ??= firstScalar(sender, ['name']);
    }
  }

  return { id, createdAt, senderId, senderName };
}
