import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { type ChatboxChatStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import { ChatboxApiClient } from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';
import type {
  ChatboxChatsListQueryDto,
  ChatboxMessagesQueryDto,
  ChatboxParticipantDto,
  ChatDetailDto,
  ChatListItemDto,
  ChatMessageDto,
  MessengerIdentityDto,
} from './dto/chatbox-chats.dto';

const SENDER_ROLE: Record<string, ChatboxParticipantDto['role']> = {
  CLIENT: 'client',
  USER: 'manager',
  ASSISTANT: 'assistant',
  QUALITY_CONTROL: 'quality_control',
};

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

  async analyzeChat(tenantId: string, chatDbId: string): Promise<{ enqueued: number }> {
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

  async listChats(
    tenantId: string,
    q: ChatboxChatsListQueryDto,
  ): Promise<{ items: ChatListItemDto[]; total: number }> {
    const take = clamp(
      q.limit ?? ChatboxChatsService.LIST_LIMIT_DEFAULT,
      1,
      ChatboxChatsService.LIST_LIMIT_MAX,
    );
    const skip = q.offset ?? 0;

    const conds: Prisma.Sql[] = [Prisma.sql`"tenantId" = ${tenantId}`];
    if (q.status) conds.push(Prisma.sql`"status" = ${q.status}::"ChatboxChatStatus"`);
    if (q.channelType) conds.push(Prisma.sql`"channelType" = ${q.channelType}`);
    if (q.customerExternalId)
      conds.push(Prisma.sql`"customerExternalId" = ${q.customerExternalId}`);
    if (q.from) conds.push(Prisma.sql`"lastMessageAt" >= ${q.from}`);
    if (q.to) conds.push(Prisma.sql`"lastMessageAt" <= ${q.to}`);
    const whereSql = Prisma.join(conds, ' AND ');

    const dialogKey = Prisma.sql`COALESCE("customerExternalId", "clientExternalId", "externalId")`;

    const rows = await this.prisma.$queryRaw<RepresentativeRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          "id",
          "externalId",
          "channelExternalId",
          "channelType",
          "clientExternalId",
          "customerExternalId",
          "responsibleExternalId",
          "title",
          "status",
          "externalCreatedAt",
          ROW_NUMBER() OVER (
            PARTITION BY "channelExternalId", ${dialogKey}
            ORDER BY "lastMessageAt" DESC NULLS LAST, "id" DESC
          ) AS rn,
          SUM("messageCount") OVER (PARTITION BY "channelExternalId", ${dialogKey}) AS group_message_count,
          BOOL_OR("isGroup") OVER (PARTITION BY "channelExternalId", ${dialogKey}) AS group_is_group,
          MAX("lastMessageAt") OVER (PARTITION BY "channelExternalId", ${dialogKey}) AS group_last_msg
        FROM "ChatboxChat"
        WHERE ${whereSql}
      )
      SELECT
        "id",
        "externalId",
        "channelExternalId",
        "channelType",
        "clientExternalId",
        "customerExternalId",
        "responsibleExternalId",
        "title",
        "status",
        "externalCreatedAt",
        group_message_count,
        group_is_group,
        group_last_msg
      FROM ranked
      WHERE rn = 1
      ORDER BY group_last_msg DESC NULLS LAST
      LIMIT ${take} OFFSET ${skip}
    `);

    const totalRows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT count(*)::bigint AS count
      FROM (
        SELECT 1
        FROM "ChatboxChat"
        WHERE ${whereSql}
        GROUP BY "channelExternalId", ${dialogKey}
      ) g
    `);
    const total = Number(totalRows[0]?.count ?? 0n);

    const chats = rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      channelExternalId: r.channelExternalId,
      channelType: r.channelType,
      clientExternalId: r.clientExternalId,
      customerExternalId: r.customerExternalId,
      responsibleExternalId: r.responsibleExternalId,
      title: r.title,
      status: r.status,
      isGroup: r.group_is_group ?? false,
      lastMessageAt: r.group_last_msg,
      messageCount: Number(r.group_message_count ?? 0n),
      externalCreatedAt: r.externalCreatedAt,
    }));

    const customerIds = uniq(chats.map((c) => c.customerExternalId).filter(isStr));
    const memberIds = uniq(chats.map((c) => c.responsibleExternalId).filter(isStr));
    const clientIds = uniq(chats.map((c) => c.clientExternalId).filter(isStr));
    const channelIds = uniq(chats.map((c) => c.channelExternalId).filter(isStr));

    const [customers, members, clients, channels] = await Promise.all([
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
      channelIds.length
        ? this.prisma.chatboxChannel.findMany({
            where: { tenantId, externalId: { in: channelIds } },
            select: { externalId: true, channelType: true, title: true },
          })
        : Promise.resolve([]),
    ]);

    const customerMap = toNameMap(customers);
    const memberMap = toNameMap(members);
    const clientMap = toNameMap(clients);
    const channelMap = new Map(channels.map((ch) => [ch.externalId, ch]));

    const items: ChatListItemDto[] = chats.map((c) => {
      const channel = c.channelExternalId ? channelMap.get(c.channelExternalId) : undefined;
      return {
        id: c.id,
        externalId: c.externalId,
        channelType: channel?.channelType || c.channelType || '',
        channelName: channel?.title ?? null,
        title: c.title ?? null,
        status: c.status,
        isGroup: c.isGroup,
        customer: c.customerExternalId
          ? {
              externalId: c.customerExternalId,
              name: customerMap.get(c.customerExternalId) ?? null,
            }
          : null,
        clientName: c.clientExternalId ? (clientMap.get(c.clientExternalId) ?? null) : null,
        responsible: c.responsibleExternalId
          ? {
              externalId: c.responsibleExternalId,
              name: memberMap.get(c.responsibleExternalId) ?? null,
            }
          : null,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        messageCount: c.messageCount,
        externalCreatedAt: c.externalCreatedAt?.toISOString() ?? null,
      };
    });

    return { items, total };
  }

  async getChat(tenantId: string, chatDbId: string): Promise<ChatDetailDto> {
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: chatDbId, tenantId },
    });
    if (!chat) throw this.chatNotFound();

    const siblingIds = await this.resolveSiblingChatIds(tenantId, chat);
    const chatIdFilter = { in: siblingIds };

    const [customer, responsible, siblingChats, identities, client, channel, grouped] =
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
        this.prisma.chatboxChat.findMany({
          where: { tenantId, id: chatIdFilter },
          select: { messageCount: true },
        }),
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
        chat.channelExternalId
          ? this.prisma.chatboxChannel.findFirst({
              where: { tenantId, externalId: chat.channelExternalId },
              select: { channelType: true, title: true },
            })
          : Promise.resolve(null),
        this.prisma.chatboxMessage.groupBy({
          by: ['senderExternalId', 'senderType'],
          where: { tenantId, chatId: chatIdFilter, senderExternalId: { not: null } },
          _count: { _all: true },
        }),
      ]);

    const rawSessions = await this.prisma.chatboxChatSession.findMany({
      where: { tenantId, chatId: chatIdFilter },
      orderBy: { startedAt: 'asc' },
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        summary: true,
        analysisStatus: true,
        previousSessionId: true,
      },
    });

    const messengerIdentities: MessengerIdentityDto[] = identities.map((i) => ({
      channelType: i.channelType,
      externalId: i.externalId,
      name: i.name ?? null,
      avatarUrl: i.avatarUrl ?? null,
    }));

    const groupedAcc = new Map<string, { senderType: string; messageCount: number }>();
    for (const g of grouped) {
      if (!g.senderExternalId) continue;
      const prev = groupedAcc.get(g.senderExternalId);
      if (prev) {
        prev.messageCount += g._count._all;
      } else {
        groupedAcc.set(g.senderExternalId, {
          senderType: g.senderType,
          messageCount: g._count._all,
        });
      }
    }

    const participantNameMap = await this.resolveSenderNames(tenantId, [...groupedAcc.keys()]);
    const participants: ChatboxParticipantDto[] = [...groupedAcc.entries()]
      .map(([externalId, g]) => ({
        externalId,
        role: SENDER_ROLE[g.senderType] ?? 'client',
        name: participantNameMap.get(externalId) ?? null,
        messageCount: g.messageCount,
      }))
      .sort((a, b) => b.messageCount - a.messageCount);

    const messageCount = siblingChats.reduce((sum, c) => sum + c.messageCount, 0);

    return {
      id: chat.id,
      externalId: chat.externalId,
      channelType: channel?.channelType || chat.channelType || '',
      channelName: channel?.title ?? null,
      title: chat.title ?? null,
      status: chat.status,
      isGroup: chat.isGroup,
      customer: customer ? { externalId: customer.externalId, name: customer.name ?? null } : null,
      clientName: client?.name ?? null,
      responsible: responsible
        ? {
            externalId: responsible.externalId,
            name: responsible.name ?? null,
          }
        : null,
      participants,
      lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
      messageCount,
      externalCreatedAt: chat.externalCreatedAt?.toISOString() ?? null,
      externalUpdatedAt: chat.externalUpdatedAt?.toISOString() ?? null,
      sessions: rawSessions.map((s, idx) => ({
        id: s.id,
        seq: idx + 1,
        startedAt: s.startedAt?.toISOString() ?? null,
        endedAt: s.endedAt?.toISOString() ?? null,
        summary: s.summary ?? null,
        analysisStatus: s.analysisStatus ?? null,
        previousSessionId: s.previousSessionId ?? null,
      })),
      messengerIdentities,
    };
  }

  async listMessages(
    tenantId: string,
    chatDbId: string,
    q: ChatboxMessagesQueryDto,
  ): Promise<{ items: ChatMessageDto[]; total: number }> {
    const chat = await this.prisma.chatboxChat.findFirst({
      where: { id: chatDbId, tenantId },
    });
    if (!chat) throw this.chatNotFound();

    const siblingIds = await this.resolveSiblingChatIds(tenantId, chat);

    const take = clamp(
      q.limit ?? ChatboxChatsService.MSG_LIMIT_DEFAULT,
      1,
      ChatboxChatsService.MSG_LIMIT_MAX,
    );
    const skip = q.offset ?? 0;
    const where = { tenantId, chatId: { in: siblingIds } };

    const [messages, total] = await Promise.all([
      this.prisma.chatboxMessage.findMany({
        where,
        orderBy: { externalCreatedAt: q.order === 'desc' ? 'desc' : 'asc' },
        take,
        skip,
      }),
      this.prisma.chatboxMessage.count({ where }),
    ]);

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
        if (mem.linkedPersonId) personByExtId.set(mem.externalId, mem.linkedPersonId);
      }
    }

    const nameByExtId = await this.resolveSenderNames(
      tenantId,
      messages.map((m) => m.senderExternalId),
    );

    const items: ChatMessageDto[] = messages.map((m) => ({
      id: m.id,
      externalId: m.externalId,
      senderType: m.senderType,
      senderName:
        m.senderType === 'ASSISTANT'
          ? 'Ассистент'
          : m.senderType === 'QUALITY_CONTROL'
            ? 'Контроль качества'
            : (nameByExtId.get(m.senderExternalId ?? '') ?? m.senderName ?? null),
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

  async sendMessage(tenantId: string, chatDbId: string, text: string): Promise<{ id: string }> {
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

    let apiMsg;
    try {
      apiMsg = await this.client.sendMessage(cfg.token, cfg.workspaceId, chat.externalId, { text });
    } catch {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_send_failed',
          message: 'Не удалось отправить сообщение в ChatBox',
        },
      });
    }

    const parsed = extractChatboxOutboundId(apiMsg);

    if (parsed.id === null) {
      this.logger.warn(
        {
          keys:
            apiMsg && typeof apiMsg === 'object' ? Object.keys(apiMsg as object) : typeof apiMsg,
        },
        'chatbox sendMessage: ответ ChatBox без message id — сохраняю по синтетическому ключу',
      );
    }
    const createdAt = parsed.createdAt ? new Date(parsed.createdAt) : new Date();
    const externalId =
      parsed.id ?? `kora-out-${createdAt.getTime()}-${Math.random().toString(36).slice(2, 8)}`;

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
      chat.lastMessageAt && chat.lastMessageAt > createdAt ? chat.lastMessageAt : createdAt;

    await this.prisma.chatboxChat.update({
      where: { id: chatDbId },
      data: {
        lastMessageAt: nextLastMessageAt,
        ...(isNewMessage ? { messageCount: { increment: 1 } } : {}),
      },
    });

    return { id: externalId };
  }

  private async resolveSiblingChatIds(
    tenantId: string,
    chat: {
      id: string;
      channelExternalId: string | null;
      customerExternalId: string | null;
      clientExternalId: string | null;
      externalId: string;
    },
  ): Promise<string[]> {
    const dialogKey =
      chat.customerExternalId ?? chat.clientExternalId ?? chat.externalId ?? null;
    if (!chat.channelExternalId || !dialogKey) return [chat.id];

    const siblings = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "ChatboxChat"
      WHERE "tenantId" = ${tenantId}
        AND "channelExternalId" = ${chat.channelExternalId}
        AND COALESCE("customerExternalId", "clientExternalId", "externalId") = ${dialogKey}
    `);
    const ids = siblings.map((s) => s.id);
    return ids.length > 0 ? ids : [chat.id];
  }

  private async resolveSenderNames(
    tenantId: string,
    externalIds: ReadonlyArray<string | null | undefined>,
  ): Promise<Map<string, string>> {
    const ids = [...new Set(externalIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return new Map();
    const [clients, members, customers] = await Promise.all([
      this.prisma.chatboxChannelClient.findMany({
        where: { tenantId, externalId: { in: ids } },
        select: { externalId: true, name: true },
      }),
      this.prisma.chatboxMember.findMany({
        where: { tenantId, externalId: { in: ids } },
        select: { externalId: true, name: true },
      }),
      this.prisma.chatboxCustomer.findMany({
        where: { tenantId, externalId: { in: ids } },
        select: { externalId: true, name: true },
      }),
    ]);
    const map = new Map<string, string>();
    for (const c of customers) if (c.name) map.set(c.externalId, c.name);
    for (const m of members) if (m.name) map.set(m.externalId, m.name);
    for (const c of clients) if (c.name) map.set(c.externalId, c.name);
    return map;
  }

  private chatNotFound(): BadRequestException {
    return new BadRequestException({
      ok: false,
      error: { code: 'chatbox_chat_not_found', message: 'Чат не найден' },
    });
  }
}

interface RepresentativeRow {
  id: string;
  externalId: string;
  channelExternalId: string;
  channelType: string;
  clientExternalId: string | null;
  customerExternalId: string | null;
  responsibleExternalId: string | null;
  title: string | null;
  status: ChatboxChatStatus;
  externalCreatedAt: Date | null;
  group_message_count: bigint | number | null;
  group_is_group: boolean | null;
  group_last_msg: Date | null;
}

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

export interface ChatboxOutboundParsed {
  id: string | null;
  createdAt: string | null;
  senderId: string | null;
  senderName: string | null;
}

const OUTBOUND_ID_KEYS = [
  'id',
  'messageId',
  'message_id',
  'externalId',
  'external_id',
  '_id',
] as const;
const OUTBOUND_CREATED_KEYS = ['createdAt', 'created_at', 'timestamp'] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function firstScalar(rec: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!rec) return null;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function extractChatboxOutboundId(raw: unknown): ChatboxOutboundParsed {
  const root = asRecord(raw);
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
