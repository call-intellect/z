import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ChatboxChatStatus,
  type ChatboxContentType,
  type ChatboxSenderType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';
import { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';
import { PersonsService } from '../persons/services/persons.service';

import {
  ChatboxApiClient,
  type ChatboxApiChannelClient,
  type ChatboxApiChat,
  type ChatboxApiMessage,
} from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
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
    @Inject(EntityResolutionService)
    private readonly entityResolution: EntityResolutionService,
    @Inject(PersonsService) private readonly persons: PersonsService,
    @Inject(ChatboxAnalyzeQueueService)
    private readonly analyzeQueue: ChatboxAnalyzeQueueService,
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

  private async isNameFuzzyEnabled(): Promise<boolean> {
    return (
      (await this.adminSettings.get<boolean>('chatbox.match.name_fuzzy_enabled', true)) ?? true
    );
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

    await this.autoLinkCustomerTable(tenantId);
    await this.autoCreateCustomersUnlinked(tenantId);

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

    await this.autoLinkChannelClientTable(tenantId);
    await this.autoCreateChannelClientsUnlinked(tenantId);

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

    await this.autoLinkMembers(tenantId);
    await this.autoCreateMembersUnlinked(tenantId);

    return members.length;
  }

  private async autoLinkMembers(tenantId: string): Promise<void> {
    const candidates = await this.prisma.chatboxMember.findMany({
      where: {
        tenantId,
        linkMode: { not: 'manual' },
      },
      select: {
        id: true,
        email: true,
        name: true,
        linkedPersonId: true,
      },
    });
    if (candidates.length === 0) return;

    const emails = [
      ...new Set(candidates.map((c) => c.email?.trim()).filter((e): e is string => !!e)),
    ];

    const personByEmail = new Map<string, string>();
    if (emails.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true },
      });
      for (const p of persons) {
        const key = p.email.trim().toLowerCase();
        if (!personByEmail.has(key)) personByEmail.set(key, p.id);
      }
    }

    const unlinkedAfterEmail: { id: string; name: string | null }[] = [];
    for (const c of candidates) {
      const key = c.email?.trim().toLowerCase();
      const personId = key ? personByEmail.get(key) : undefined;
      if (personId) {
        if (c.linkedPersonId === personId) continue;
        await this.prisma.chatboxMember.update({
          where: { id: c.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
        await this.upgradePersonToEmployee(tenantId, personId);
        continue;
      }
      if (c.linkedPersonId === null) {
        unlinkedAfterEmail.push({ id: c.id, name: c.name });
      }
    }

    await this.autoLinkByName({
      tenantId,
      rows: unlinkedAfterEmail,
      update: (id, personId) =>
        this.prisma.chatboxMember.update({
          where: { id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        }),
    });
  }

  private async autoLinkByName(args: {
    tenantId: string;
    rows: { id: string; name: string | null }[];
    update: (id: string, personId: string) => Promise<unknown>;
  }): Promise<void> {
    if (args.rows.length === 0) return;
    if (!(await this.isNameFuzzyEnabled())) return;

    for (const row of args.rows) {
      const name = row.name?.trim();
      if (!name) continue;
      const personId = await this.entityResolution.resolvePersonByHint(args.tenantId, name);
      if (!personId) continue;
      await args.update(row.id, personId);
    }
  }

  async autoLinkCustomers(tenantId: string): Promise<void> {
    await this.autoLinkCustomerTable(tenantId);
    await this.autoLinkChannelClientTable(tenantId);
  }

  private async autoLinkCustomerTable(tenantId: string): Promise<void> {
    await this.autoLinkContactTable({
      tenantId,
      load: () =>
        this.prisma.chatboxCustomer.findMany({
          where: { tenantId, linkMode: { not: 'manual' } },
          select: {
            id: true,
            email: true,
            name: true,
            linkedPersonId: true,
          },
        }),
      update: (id, personId) =>
        this.prisma.chatboxCustomer.update({
          where: { id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        }),
    });
  }

  private async autoLinkChannelClientTable(tenantId: string): Promise<void> {
    await this.autoLinkContactTable({
      tenantId,
      load: () =>
        this.prisma.chatboxChannelClient.findMany({
          where: { tenantId, linkMode: { not: 'manual' } },
          select: {
            id: true,
            email: true,
            name: true,
            linkedPersonId: true,
          },
        }),
      update: (id, personId) =>
        this.prisma.chatboxChannelClient.update({
          where: { id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        }),
    });
  }

  private async autoLinkContactTable(args: {
    tenantId: string;
    load: () => Promise<
      { id: string; email: string | null; name: string | null; linkedPersonId: string | null }[]
    >;
    update: (id: string, personId: string) => Promise<unknown>;
  }): Promise<void> {
    const candidates = await args.load();
    if (candidates.length === 0) return;

    const emails = [
      ...new Set(candidates.map((c) => c.email?.trim()).filter((e): e is string => !!e)),
    ];

    const personByEmail = new Map<string, string>();
    if (emails.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId: args.tenantId, email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true },
      });
      for (const p of persons) {
        const key = p.email.trim().toLowerCase();
        if (!personByEmail.has(key)) personByEmail.set(key, p.id);
      }
    }

    const unlinkedAfterEmail: { id: string; name: string | null }[] = [];
    for (const c of candidates) {
      const key = c.email?.trim().toLowerCase();
      const personId = key ? personByEmail.get(key) : undefined;
      if (personId) {
        if (c.linkedPersonId === personId) continue;
        await args.update(c.id, personId);
        continue;
      }
      if (c.linkedPersonId === null) {
        unlinkedAfterEmail.push({ id: c.id, name: c.name });
      }
    }

    await this.autoLinkByName({
      tenantId: args.tenantId,
      rows: unlinkedAfterEmail,
      update: args.update,
    });
  }

  private async resolveOwnerUserId(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  private async upgradePersonToEmployee(tenantId: string, personId: string): Promise<void> {
    await this.prisma.person.updateMany({
      where: { id: personId, tenantId, relationship: 'external', deletedAt: null },
      data: { relationship: 'employee' },
    });
  }

  private async autoCreateForUnlinked(args: {
    tenantId: string;
    ownerUserId: string;
    relationship: 'employee' | 'external';
    rows: { id: string; email: string | null; name: string | null }[];
    update: (id: string, personId: string) => Promise<unknown>;
  }): Promise<void> {
    for (const r of args.rows) {
      const email = r.email?.trim() || null;
      const name = r.name?.trim() || null;
      if (!email && !name) continue;
      try {
        let personId: string | null = null;
        if (email) {
          const existing = await this.prisma.person.findFirst({
            where: { tenantId: args.tenantId, email, deletedAt: null },
            select: { id: true },
          });
          personId = existing?.id ?? null;
        }
        if (!personId) {
          const created = await this.persons.create({
            tenantId: args.tenantId,
            userId: args.ownerUserId,
            body: {
              name: name ?? email ?? 'Без имени',
              ...(email ? { email } : {}),
              relationship: args.relationship,
            },
          });
          personId = created.id;
        }
        if (args.relationship === 'employee') {
          await this.upgradePersonToEmployee(args.tenantId, personId);
        }
        await args.update(r.id, personId);
      } catch (err) {
        this.logger.warn(
          { rowId: r.id, err: err instanceof Error ? err.message : String(err) },
          'autoCreateForUnlinked: не удалось создать/связать — пропуск',
        );
      }
    }
  }

  private async autoCreateMembersUnlinked(tenantId: string): Promise<void> {
    const ownerUserId = await this.resolveOwnerUserId(tenantId);
    if (!ownerUserId) return;
    const rows = await this.prisma.chatboxMember.findMany({
      where: { tenantId, linkedPersonId: null, linkMode: { not: 'manual' } },
      select: { id: true, email: true, name: true },
    });
    await this.autoCreateForUnlinked({
      tenantId,
      ownerUserId,
      relationship: 'employee',
      rows,
      update: (id, personId) =>
        this.prisma.chatboxMember.update({
          where: { id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        }),
    });
  }

  private async autoCreateCustomersUnlinked(tenantId: string): Promise<void> {
    const ownerUserId = await this.resolveOwnerUserId(tenantId);
    if (!ownerUserId) return;
    const customers = await this.prisma.chatboxCustomer.findMany({
      where: { tenantId, linkedPersonId: null, linkMode: { not: 'manual' } },
      select: { id: true, email: true, name: true },
    });
    await this.autoCreateForUnlinked({
      tenantId,
      ownerUserId,
      relationship: 'external',
      rows: customers,
      update: (id, personId) =>
        this.prisma.chatboxCustomer.update({
          where: { id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        }),
    });
  }

  private async autoCreateChannelClientsUnlinked(tenantId: string): Promise<void> {
    const ownerUserId = await this.resolveOwnerUserId(tenantId);
    if (!ownerUserId) return;
    const channelClients = await this.prisma.chatboxChannelClient.findMany({
      where: { tenantId, linkedPersonId: null, linkMode: { not: 'manual' } },
      select: { id: true, email: true, name: true },
    });
    await this.autoCreateForUnlinked({
      tenantId,
      ownerUserId,
      relationship: 'external',
      rows: channelClients,
      update: (id, personId) =>
        this.prisma.chatboxChannelClient.update({
          where: { id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        }),
    });
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

  async syncMessages(tenantId: string, chatDbId: string, chatExternalId: string): Promise<number> {
    const cfg = await this.loadCfg(tenantId);
    const messages = await this.paginateAll<ChatboxApiMessage>(async (limit, offset) => {
      const res = await this.client.listMessages(cfg.token, cfg.workspaceId, chatExternalId, {
        limit,
        offset,
        order: 'asc',
      });
      return { items: res.messages ?? [], total: res.total };
    });

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

    await this.prisma.chatboxChat.update({
      where: { id: chatDbId },
      data: { messageCount: messages.length, lastMessageAt },
    });

    return messages.length;
  }

  async syncChats(tenantId: string, opts?: { since?: Date }): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncChats: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);

    const channels = await this.prisma.chatboxChannel.findMany({
      where: { tenantId },
      select: { externalId: true, channelType: true },
    });
    const channelTypeByExt = new Map(channels.map((c) => [c.externalId, c.channelType]));

    let count = 0;
    let offset = 0;
    let total = Infinity;
    let page = 0;
    let stop = false;

    while (!stop && count < total) {
      if (page >= MAX_PAGES) {
        this.logger.warn(
          `syncChats: достигнут кап ${MAX_PAGES} страниц (${count}/${total}) — остановка`,
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
        const updatedAt = new Date(apiChat.updatedAt);
        if (opts?.since && updatedAt < opts.since) {
          stop = true;
          break;
        }

        const chatDbId = await this.upsertChat(tenantId, apiChat, channelTypeByExt);
        await this.syncMessages(tenantId, chatDbId, apiChat.id);
        count += 1;
      }

      page += 1;
      offset += PAGE_SIZE;
    }

    return count;
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
  }> {
    if (!(await this.isEnabled())) {
      this.logger.log('fullSync: chatbox.enabled=false — пропуск');
      return {
        channels: 0,
        customers: 0,
        channelClients: 0,
        members: 0,
        chats: 0,
      };
    }
    const channels = await this.syncChannels(tenantId);
    const customers = await this.syncCustomers(tenantId);
    const channelClients = await this.syncChannelClients(tenantId);
    const members = await this.syncMembers(tenantId);
    const chats = await this.syncChats(tenantId);

    await this.prisma.chatboxIntegration.updateMany({
      where: { tenantId },
      data: { lastFullSyncAt: new Date() },
    });

    return { channels, customers, channelClients, members, chats };
  }

  async incrementalSync(tenantId: string): Promise<{
    channels: number;
    customers: number;
    channelClients: number;
    members: number;
    chats: number;
  }> {
    if (!(await this.isEnabled())) {
      this.logger.log('incrementalSync: chatbox.enabled=false — пропуск');
      return {
        channels: 0,
        customers: 0,
        channelClients: 0,
        members: 0,
        chats: 0,
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
    const chats = await this.syncChats(tenantId, {
      since: row?.lastIncrementalSyncAt ?? undefined,
    });

    await this.prisma.chatboxIntegration.updateMany({
      where: { tenantId },
      data: { lastIncrementalSyncAt: startedAt },
    });

    return { channels, customers, channelClients, members, chats };
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
        const chats = await this.syncChats(tenantId, opts);
        const analysisEnqueued = await this.enqueuePendingAnalysisIfEnabled(tenantId);
        return { chats, analysisEnqueued };
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
