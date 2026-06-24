import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChatboxChatStatus,
  type ChatboxContentType,
  type ChatboxSenderType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';

import {
  ChatboxApiClient,
  type ChatboxApiChannelClient,
  type ChatboxApiChat,
  type ChatboxApiMessage,
} from './chatbox-api.client';
import { ChatboxCustomersService } from './chatbox-customers.service';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import { ChatboxMembersService } from './chatbox-members.service';
import { ChatboxSessionService } from './chatbox-session.service';
import { ChatboxAnalyzeQueueService } from './queue/chatbox-analyze.queue.service';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;

type SyncCfg = { workspaceId: string; token: string; integrationId: string };

@Injectable()
export class ChatboxSyncService {
  private readonly logger = new Logger(ChatboxSyncService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ChatboxApiClient) private readonly client: ChatboxApiClient,
    @Inject(ChatboxIntegrationService)
    private readonly integration: ChatboxIntegrationService,
    @Inject(ChatboxSessionService)
    private readonly sessions: ChatboxSessionService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly analyzeQueue: ChatboxAnalyzeQueueService,
    @Inject(ChatboxCustomersService)
    private readonly customers: ChatboxCustomersService,
    @Inject(ChatboxMembersService)
    private readonly members: ChatboxMembersService,
  ) {}

  private async loadCfg(tenantId: string): Promise<SyncCfg> {
    const cfg = await this.integration.getConfigForSync(tenantId);
    if (!cfg) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'chatbox_not_configured',
          message: 'ChatBox-интеграция не настроена',
        },
      });
    }
    return cfg;
  }

  private async isEnabled(): Promise<boolean> {
    return (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true;
  }

  private async paginateAll<T>(
    fetchPage: (
      limit: number,
      offset: number,
    ) => Promise<{
      items: T[];
      total: number;
    }>,
  ): Promise<T[]> {
    const acc: T[] = [];
    let offset = 0;
    let total = Infinity;
    let page = 0;

    while (acc.length < total) {
      if (page >= MAX_PAGES) {
        this.logger.warn(
          `paginateAll: достигнут кап ${MAX_PAGES} страниц (${acc.length}/${total}) — остановка`,
        );
        break;
      }
      const { items, total: pageTotal } = await fetchPage(PAGE_SIZE, offset);
      total = pageTotal;
      acc.push(...items);
      page += 1;
      offset += PAGE_SIZE;
      if (items.length === 0) break;
    }
    return acc;
  }

  async syncChannels(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncChannels: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);
    const channels = await this.paginateAll(async (limit, offset) => {
      const res = await this.client.listChannels(cfg.token, cfg.workspaceId, {
        limit,
        offset,
      });
      return { items: res.channels ?? [], total: res.total };
    });

    const now = new Date();
    for (const ch of channels) {
      const data = {
        channelType: ch.type,
        title: ch.title,
        description: ch.description ?? null,
        isActive: ch.isActive,
        raw: ch as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.chatboxChannel.upsert({
        where: { tenantId_externalId: { tenantId, externalId: ch.id } },
        create: { tenantId, externalId: ch.id, ...data },
        update: data,
      });
    }
    return channels.length;
  }

  async syncCustomers(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncCustomers: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);
    const customers = await this.paginateAll(async (limit, offset) => {
      const res = await this.client.listCustomers(cfg.token, cfg.workspaceId, {
        limit,
        offset,
      });
      return { items: res.customers ?? [], total: res.total };
    });

    const now = new Date();
    for (const c of customers) {
      const data = {
        name: c.name ?? null,
        phone: c.phone ?? null,
        email: c.email ?? null,
        externalCrmId: c.externalId ?? null,
        raw: c as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.chatboxCustomer.upsert({
        where: { tenantId_externalId: { tenantId, externalId: c.id } },
        create: { tenantId, externalId: c.id, ...data },
        update: data,
      });
    }

    const auto = await this.customers.autoLinkUnlinked(tenantId);
    this.logger.log(
      `syncCustomers: авто-привязка клиентов — создано ${auto.created}, привязано ${auto.linked}`,
    );

    return customers.length;
  }

  async syncChannelClients(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncChannelClients: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);
    const clients = await this.paginateAll<ChatboxApiChannelClient>(async (limit, offset) => {
      const res = await this.client.listChannelClients(cfg.token, cfg.workspaceId, {
        limit,
        offset,
      });
      return { items: res.clients ?? [], total: res.total };
    });

    const customerExtIds = [
      ...new Set(clients.map((c) => c.customerId).filter((v): v is string => Boolean(v))),
    ];
    const customers =
      customerExtIds.length > 0
        ? await this.prisma.chatboxCustomer.findMany({
            where: { tenantId, externalId: { in: customerExtIds } },
            select: { id: true, externalId: true },
          })
        : [];
    const customerIdByExt = new Map(customers.map((c) => [c.externalId, c.id]));

    const now = new Date();
    for (const cc of clients) {
      const customerExternalId = cc.customerId ?? null;
      const customerId = customerExternalId
        ? (customerIdByExt.get(customerExternalId) ?? null)
        : null;
      const data = {
        customerExternalId,
        customerId,
        channelType: cc.channelType,
        channelExternalId: cc.channelId ?? null,
        messengerUserId: cc.externalId ?? null,
        name: cc.name ?? null,
        phone: cc.phone ?? null,
        email: cc.email ?? null,
        avatarUrl: cc.avatarUrl ?? null,
        isBlocked: cc.isBlocked,
        raw: cc as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.chatboxChannelClient.upsert({
        where: { tenantId_externalId: { tenantId, externalId: cc.id } },
        create: { tenantId, externalId: cc.id, ...data },
        update: data,
      });
    }

    const auto = await this.customers.autoLinkChannelClients(tenantId);
    this.logger.log(
      `syncChannelClients: авто-контакты — создано ${auto.created}, привязано ${auto.linked}`,
    );

    return clients.length;
  }

  async syncMembers(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncMembers: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);
    const members = await this.paginateAll(async (limit, offset) => {
      const res = await this.client.listMembers(cfg.token, cfg.workspaceId, {
        limit,
        offset,
      });
      return { items: res.members ?? [], total: res.total };
    });

    const now = new Date();
    for (const m of members) {
      const data = {
        email: m.email ?? null,
        name: m.name ?? null,
        role: m.role ?? null,
        raw: m as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.chatboxMember.upsert({
        where: { tenantId_externalId: { tenantId, externalId: m.id } },
        create: { tenantId, externalId: m.id, ...data },
        update: data,
      });
    }

    const auto = await this.members.autoLinkUnlinked(tenantId);
    this.logger.log(
      `syncMembers: авто-привязка менеджеров — создано ${auto.created}, привязано ${auto.linked}`,
    );

    return members.length;
  }

  private async enqueuePendingAnalysisIfEnabled(tenantId: string): Promise<number> {
    const integ = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
      select: { analysisEnabled: true },
    });
    if (!integ?.analysisEnabled) return 0;
    const sessions = await this.prisma.chatboxChatSession.findMany({
      where: { tenantId, analysisStatus: 'pending', endedAt: { not: null } },
      select: { id: true },
    });
    let enqueued = 0;
    for (const s of sessions) {
      try {
        await this.analyzeQueue.enqueue(tenantId, s.id);
        enqueued += 1;
      } catch (err) {
        this.logger.warn(
          {
            sessionId: s.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'enqueuePendingAnalysis: не удалось поставить job — пропуск',
        );
      }
    }
    return enqueued;
  }

  async syncMessages(
    tenantId: string,
    chatDbId: string,
    chatExternalId: string,
  ): Promise<{ total: number; created: number }> {
    const cfg = await this.loadCfg(tenantId);
    const messages = await this.paginateAll<ChatboxApiMessage>(async (limit, offset) => {
      const res = await this.client.listMessages(cfg.token, cfg.workspaceId, chatExternalId, {
        limit,
        offset,
        order: 'asc',
      });
      return { items: res.messages ?? [], total: res.total };
    });

    const ids = messages.map((m) => m.id);
    const existingRows = ids.length
      ? await this.prisma.chatboxMessage.findMany({
          where: { tenantId, externalId: { in: ids } },
          select: { externalId: true },
        })
      : [];
    const existingSet = new Set(existingRows.map((r) => r.externalId));
    const created = ids.filter((id) => !existingSet.has(id)).length;

    let lastMessageAt: Date | null = null;
    for (const m of messages) {
      const createdAt = new Date(m.createdAt);
      if (!lastMessageAt || createdAt > lastMessageAt) lastMessageAt = createdAt;

      const data = {
        chatId: chatDbId,
        senderType: this.mapSenderType(m.sender?.type),
        senderExternalId: m.sender?.id ?? null,
        senderName: m.sender?.name ?? null,
        contentType: this.mapContentType(m.content?.type),
        text: m.content?.text ?? null,
        imageUrl: m.content?.imageUrl ?? null,
        fileUrl: m.content?.fileUrl ?? null,
        audioUrl: m.content?.audioUrl ?? null,
        videoUrl: m.content?.videoUrl ?? null,
        externalCreatedAt: createdAt,
        raw: m as unknown as Prisma.InputJsonValue,
      };
      await this.prisma.chatboxMessage.upsert({
        where: { tenantId_externalId: { tenantId, externalId: m.id } },
        create: { tenantId, externalId: m.id, ...data },
        update: data,
      });
    }

    await this.sessions.rebuildSessions(tenantId, chatDbId);

    const clientSenders = await this.prisma.chatboxMessage.findMany({
      where: { tenantId, chatId: chatDbId, senderType: 'CLIENT', senderExternalId: { not: null } },
      select: { senderExternalId: true },
      distinct: ['senderExternalId'],
    });
    const isGroup = clientSenders.length > 1;

    await this.prisma.chatboxChat.update({
      where: { id: chatDbId },
      data: { messageCount: messages.length, lastMessageAt, isGroup },
    });

    return { total: messages.length, created };
  }

  async syncChats(
    tenantId: string,
    opts?: { since?: Date },
  ): Promise<{ chats: number; newChats: number; messages: number; newMessages: number }> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncChats: chatbox.enabled=false — пропуск');
      return { chats: 0, newChats: 0, messages: 0, newMessages: 0 };
    }
    const cfg = await this.loadCfg(tenantId);

    const existingChannels = await this.prisma.chatboxChannel.count({ where: { tenantId } });
    if (existingChannels === 0) {
      await this.syncChannels(tenantId);
    }

    const channels = await this.prisma.chatboxChannel.findMany({
      where: { tenantId },
      select: { externalId: true, channelType: true },
    });
    const channelTypeByExt = new Map(channels.map((c) => [c.externalId, c.channelType]));

    let count = 0;
    let newChats = 0;
    let messages = 0;
    let newMessages = 0;
    let scanned = 0;
    let offset = 0;
    let total = Infinity;
    let page = 0;

    while (scanned < total) {
      if (page >= MAX_PAGES) {
        this.logger.warn(
          `syncChats: достигнут кап ${MAX_PAGES} страниц (${scanned}/${total}) — остановка`,
        );
        break;
      }
      const res = await this.client.listChats(cfg.token, cfg.workspaceId, {
        limit: PAGE_SIZE,
        offset,
        order: 'desc',
      });
      total = res.total;
      const items = res.chats ?? [];
      if (items.length === 0) break;

      for (const apiChat of items) {
        scanned += 1;
        const updatedAt = new Date(apiChat.updatedAt);
        if (opts?.since && updatedAt < opts.since) {
          continue;
        }

        const existedChat = await this.prisma.chatboxChat.findFirst({
          where: { tenantId, externalId: apiChat.id },
          select: { id: true },
        });
        if (!existedChat) newChats += 1;

        const chatDbId = await this.upsertChat(tenantId, apiChat, channelTypeByExt);
        const m = await this.syncMessages(tenantId, chatDbId, apiChat.id);
        messages += m.total;
        newMessages += m.created;
        count += 1;
      }

      page += 1;
      offset += PAGE_SIZE;
    }

    return { chats: count, newChats, messages, newMessages };
  }

  private async upsertChat(
    tenantId: string,
    apiChat: ChatboxApiChat,
    channelTypeByExt: Map<string, string>,
  ): Promise<string> {
    const channelExternalId = apiChat.channelId;
    const channelType = channelTypeByExt.get(channelExternalId) ?? '';

    const clientExternalId = apiChat.client?.id ?? null;
    let customerExternalId: string | null = null;
    if (clientExternalId) {
      const cc = await this.prisma.chatboxChannelClient.findUnique({
        where: {
          tenantId_externalId: { tenantId, externalId: clientExternalId },
        },
        select: { customerExternalId: true },
      });
      customerExternalId = cc?.customerExternalId ?? null;
    }

    const data = {
      channelExternalId,
      channelType,
      clientExternalId,
      customerExternalId,
      responsibleExternalId: apiChat.responsible?.id ?? null,
      status: this.mapStatus(apiChat.status),
      externalCreatedAt: new Date(apiChat.createdAt),
      externalUpdatedAt: new Date(apiChat.updatedAt),
      raw: apiChat as unknown as Prisma.InputJsonValue,
      syncedAt: new Date(),
    };

    const chat = await this.prisma.chatboxChat.upsert({
      where: { tenantId_externalId: { tenantId, externalId: apiChat.id } },
      create: { tenantId, externalId: apiChat.id, ...data },
      update: data,
      select: { id: true },
    });
    return chat.id;
  }

  async fullSync(tenantId: string): Promise<{
    channels: number;
    customers: number;
    channelClients: number;
    members: number;
    chats: number;
    newChats: number;
    messages: number;
    newMessages: number;
  }> {
    if (!(await this.isEnabled())) {
      this.logger.log('fullSync: chatbox.enabled=false — пропуск');
      return {
        channels: 0,
        customers: 0,
        channelClients: 0,
        members: 0,
        chats: 0,
        newChats: 0,
        messages: 0,
        newMessages: 0,
      };
    }
    const channels = await this.syncChannels(tenantId);
    const customers = await this.syncCustomers(tenantId);
    const channelClients = await this.syncChannelClients(tenantId);
    const members = await this.syncMembers(tenantId);
    const { chats, newChats, messages, newMessages } = await this.syncChats(tenantId);

    await this.prisma.chatboxIntegration.updateMany({
      where: { tenantId },
      data: { lastFullSyncAt: new Date() },
    });

    return { channels, customers, channelClients, members, chats, newChats, messages, newMessages };
  }

  async incrementalSync(tenantId: string): Promise<{
    channels: number;
    customers: number;
    channelClients: number;
    members: number;
    chats: number;
    newChats: number;
    messages: number;
    newMessages: number;
    analysisEnqueued: number;
  }> {
    if (!(await this.isEnabled())) {
      this.logger.log('incrementalSync: chatbox.enabled=false — пропуск');
      return {
        channels: 0,
        customers: 0,
        channelClients: 0,
        members: 0,
        chats: 0,
        newChats: 0,
        messages: 0,
        newMessages: 0,
        analysisEnqueued: 0,
      };
    }
    const startedAt = new Date();

    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
      select: { lastIncrementalSyncAt: true },
    });

    const channels = await this.syncChannels(tenantId);
    const customers = await this.syncCustomers(tenantId);
    const channelClients = await this.syncChannelClients(tenantId);
    const members = await this.syncMembers(tenantId);
    const { chats, newChats, messages, newMessages } = await this.syncChats(tenantId, {
      since: row?.lastIncrementalSyncAt ?? undefined,
    });

    await this.prisma.chatboxIntegration.updateMany({
      where: { tenantId },
      data: { lastIncrementalSyncAt: startedAt },
    });

    const analysisEnqueued = await this.enqueuePendingAnalysisIfEnabled(tenantId);

    return {
      channels,
      customers,
      channelClients,
      members,
      chats,
      newChats,
      messages,
      newMessages,
      analysisEnqueued,
    };
  }

  async syncByScope(
    tenantId: string,
    scope: 'all' | 'customers' | 'managers' | 'chats',
    opts?: { since?: Date },
  ): Promise<Record<string, number>> {
    switch (scope) {
      case 'all': {
        const result = await this.fullSync(tenantId);
        const analysisEnqueued = await this.enqueuePendingAnalysisIfEnabled(tenantId);
        return { ...result, analysisEnqueued };
      }
      case 'customers': {
        const customers = await this.syncCustomers(tenantId);
        const channelClients = await this.syncChannelClients(tenantId);
        return { customers, channelClients };
      }
      case 'managers': {
        const members = await this.syncMembers(tenantId);
        return { members };
      }
      case 'chats': {
        const { chats, newChats, messages, newMessages } = await this.syncChats(tenantId, opts);
        const analysisEnqueued = await this.enqueuePendingAnalysisIfEnabled(tenantId);
        return { chats, newChats, messages, newMessages, analysisEnqueued };
      }
    }
  }

  private mapSenderType(type: string | null | undefined): ChatboxSenderType {
    const allowed: ChatboxSenderType[] = ['CLIENT', 'USER', 'ASSISTANT', 'QUALITY_CONTROL'];
    if (type && allowed.includes(type as ChatboxSenderType)) {
      return type as ChatboxSenderType;
    }
    return 'CLIENT';
  }

  private mapContentType(type: string | null | undefined): ChatboxContentType {
    const allowed: ChatboxContentType[] = [
      'TEXT',
      'IMAGE',
      'AUDIO',
      'VIDEO',
      'VIDEO_NOTE',
      'FILE',
      'VOICE',
      'COMMAND',
    ];
    if (type && allowed.includes(type as ChatboxContentType)) {
      return type as ChatboxContentType;
    }
    return 'TEXT';
  }

  private mapStatus(status: string): ChatboxChatStatus {
    return status.toLowerCase() === 'closed' ? 'closed' : 'active';
  }
}
