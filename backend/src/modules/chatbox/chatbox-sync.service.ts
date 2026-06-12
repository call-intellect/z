import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  type ChatboxChatStatus,
  type ChatboxContentType,
  type ChatboxSenderType,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';
import { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';

import {
  ChatboxApiClient,
  type ChatboxApiChannelClient,
  type ChatboxApiChat,
  type ChatboxApiMessage,
} from './chatbox-api.client';
import { ChatboxIntegrationService } from './chatbox-integration.service';
import { ChatboxSessionService } from './chatbox-session.service';

/**
 * ChatboxSyncService — синк данных ChatBox в зеркальные таблицы Коры
 * (ТЗ plans/tz/2026-06-05-chatbox-integration.md, Фаза 3).
 *
 * Чистый сервис (без BullMQ/контроллера — это отдельный кодер). Все методы
 * принимают `tenantId`. Kill-switch `chatbox.enabled` (admin settings) глушит
 * синк (no-op + лог). Конфиг (workspaceId + расшифрованный токен) берётся через
 * ChatboxIntegrationService.getConfigForSync; отсутствие → BadRequestException
 * `chatbox_not_configured`.
 *
 * Enum-маппинг: значения ChatBox для sender.type / content.type совпадают с
 * нашими enum'ами (верхний регистр) — приводим как есть. status приводим к
 * нижнему регистру ('active'/'closed').
 */

/** Размер страницы пагинации ChatBox API. */
const PAGE_SIZE = 100;
/** Защитный кап числа страниц (100 * 100 = 10000 записей). */
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
    // Ф1 — fuzzy-резолв имени собеседника в Person для имя-ступени каскада
    // автосвязки (`resolvePersonByHint`: exact + ILIKE; неоднозначность → null).
    @Inject(EntityResolutionService)
    private readonly entityResolution: EntityResolutionService,
  ) {}

  // ─────────────────────────── helpers ──────────────────────────────

  /** Конфиг синка или throw `chatbox_not_configured`. */
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

  /** Kill-switch: false → синк не выполняется. */
  private async isEnabled(): Promise<boolean> {
    return (
      (await this.adminSettings.get<boolean>('chatbox.enabled', true)) ?? true
    );
  }

  /**
   * Ф1 — ступень fuzzy-сопоставления по имени (AdminSetting,
   * code-fallback true). Когда false — каскад автосвязки ограничивается
   * email-ступенью (имя-ступень пропускается).
   */
  private async isNameFuzzyEnabled(): Promise<boolean> {
    return (
      (await this.adminSettings.get<boolean>(
        'chatbox.match.name_fuzzy_enabled',
        true,
      )) ?? true
    );
  }

  /**
   * Прокачать все страницы пагинированного эндпоинта. Идёт пока собрано < total,
   * с защитным капом MAX_PAGES (warn при достижении).
   */
  private async paginateAll<T>(
    fetchPage: (limit: number, offset: number) => Promise<{
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
      if (items.length === 0) break; // защита от зацикливания при кривом total
    }
    return acc;
  }

  // ─────────────────────────── каналы ──────────────────────────────

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

  // ─────────────────────────── customers ───────────────────────────

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

    // Ф1 — автосвязка клиентов (ChatboxCustomer) с Person (email → имя-fuzzy).
    // linkedPersonId / linkMode не пишем в upsert выше (как у members), чтобы не
    // перетереть manual.
    await this.autoLinkCustomerTable(tenantId);

    return customers.length;
  }

  // ─────────────────────────── channel clients ─────────────────────

  async syncChannelClients(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncChannelClients: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);
    const clients = await this.paginateAll<ChatboxApiChannelClient>(
      async (limit, offset) => {
        const res = await this.client.listChannelClients(
          cfg.token,
          cfg.workspaceId,
          { limit, offset },
        );
        return { items: res.clients ?? [], total: res.total };
      },
    );

    // Карта customerExternalId → внутренний ChatboxCustomer.id (для связи).
    const customerExtIds = [
      ...new Set(
        clients
          .map((c) => c.customerId)
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const customers =
      customerExtIds.length > 0
        ? await this.prisma.chatboxCustomer.findMany({
            where: { tenantId, externalId: { in: customerExtIds } },
            select: { id: true, externalId: true },
          })
        : [];
    const customerIdByExt = new Map(
      customers.map((c) => [c.externalId, c.id]),
    );

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

    // Ф1 — автосвязка собеседников канала (ChatboxChannelClient) с Person.
    await this.autoLinkChannelClientTable(tenantId);

    return clients.length;
  }

  // ─────────────────────────── members ─────────────────────────────

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
      // linkedPersonId / linkMode НЕ трогаем в upsert — автосвязка отдельным
      // проходом ниже (Фаза 9), чтобы не перетереть ручную связку (manual).
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

    return members.length;
  }

  /**
   * Автосвязка членов ChatBox с Person Коры. Каскад (Ф1):
   *   1) email-ступень (case-insensitive) — Фаза 9;
   *   2) имя-ступень (fuzzy, `resolvePersonByHint`) для оставшихся несвязанных,
   *      за AdminSetting `chatbox.match.name_fuzzy_enabled` (code-fallback true).
   * Ручную связку (`linkMode='manual'`) НЕ трогаем (исключена из выборки).
   *
   * Email-ступень — батч (один findMany Person, без N+1). Имя-ступень —
   * per-candidate резолв (exact + ILIKE; неоднозначность → null), как у встреч.
   */
  private async autoLinkMembers(tenantId: string): Promise<void> {
    // ── ступень 1: email (батч) ──
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
      ...new Set(
        candidates
          .map((c) => c.email?.trim())
          .filter((e): e is string => !!e),
      ),
    ];

    const personByEmail = new Map<string, string>();
    if (emails.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true },
      });
      for (const p of persons) {
        // Первый выигрывает; lowercase-ключ для case-insensitive сопоставления.
        const key = p.email.trim().toLowerCase();
        if (!personByEmail.has(key)) personByEmail.set(key, p.id);
      }
    }

    // Отслеживаем, кто остался несвязанным после email-ступени — для имя-ступени.
    const unlinkedAfterEmail: { id: string; name: string | null }[] = [];
    for (const c of candidates) {
      const key = c.email?.trim().toLowerCase();
      const personId = key ? personByEmail.get(key) : undefined;
      if (personId) {
        if (c.linkedPersonId === personId) continue; // уже связан корректно
        await this.prisma.chatboxMember.update({
          where: { id: c.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
        continue;
      }
      // email не дал результата — кандидат на имя-ступень (если ещё не связан).
      if (c.linkedPersonId === null) {
        unlinkedAfterEmail.push({ id: c.id, name: c.name });
      }
    }

    // ── ступень 2: имя (fuzzy), за флагом ──
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

  /**
   * Имя-ступень каскада (общая для members/customers/channelClients). Для каждой
   * несвязанной строки с непустым именем — `resolvePersonByHint` (однозначный хит
   * → linkedPersonId + linkMode='auto'). Пропускается целиком, если флаг
   * `chatbox.match.name_fuzzy_enabled` выключен. Неоднозначное имя → null → пропуск.
   */
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
      const personId = await this.entityResolution.resolvePersonByHint(
        args.tenantId,
        name,
      );
      if (!personId) continue; // нет хита / неоднозначно
      await args.update(row.id, personId);
    }
  }

  /**
   * Автосвязка клиентов ChatBox (ChatboxCustomer И ChatboxChannelClient) с Person
   * Коры за один проход. Тот же каскад, что и для менеджеров: email
   * (case-insensitive) → имя-fuzzy (за флагом). Ручную связку (`manual`) не
   * трогаем. Доступен как единая точка; синк-методы вызывают пер-табличные
   * варианты (`autoLinkCustomerTable` / `autoLinkChannelClientTable`), чтобы не
   * дублировать работу в `fullSync`.
   */
  async autoLinkCustomers(tenantId: string): Promise<void> {
    await this.autoLinkCustomerTable(tenantId);
    await this.autoLinkChannelClientTable(tenantId);
  }

  /** Ф1 — автосвязка только таблицы ChatboxCustomer. */
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

  /** Ф1 — автосвязка только таблицы ChatboxChannelClient. */
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

  /**
   * Обобщённый каскад автосвязки для контактной таблицы (Customer/ChannelClient).
   * email-ступень батчем + имя-ступень fuzzy. Не трогает уже-связанные и manual.
   */
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
      ...new Set(
        candidates
          .map((c) => c.email?.trim())
          .filter((e): e is string => !!e),
      ),
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

  // ─────────────────────────── messages ────────────────────────────

  /**
   * Синк сообщений одного чата + пересборка сессий. `chatDbId` — внутренний id
   * ChatboxChat, `chatExternalId` — id в ChatBox.
   */
  async syncMessages(
    tenantId: string,
    chatDbId: string,
    chatExternalId: string,
  ): Promise<number> {
    const cfg = await this.loadCfg(tenantId);
    const messages = await this.paginateAll<ChatboxApiMessage>(
      async (limit, offset) => {
        const res = await this.client.listMessages(
          cfg.token,
          cfg.workspaceId,
          chatExternalId,
          { limit, offset, order: 'asc' },
        );
        return { items: res.messages ?? [], total: res.total };
      },
    );

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

    // Пересборка сессий чата по актуальным сообщениям.
    await this.sessions.rebuildSessions(tenantId, chatDbId);

    // Обновляем агрегаты чата.
    await this.prisma.chatboxChat.update({
      where: { id: chatDbId },
      data: { messageCount: messages.length, lastMessageAt },
    });

    return messages.length;
  }

  // ─────────────────────────── chats ───────────────────────────────

  async syncChats(
    tenantId: string,
    opts?: { since?: Date },
  ): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.log('syncChats: chatbox.enabled=false — пропуск');
      return 0;
    }
    const cfg = await this.loadCfg(tenantId);

    // Карта channelExternalId → channelType (резолв типа канала для чата).
    const channels = await this.prisma.chatboxChannel.findMany({
      where: { tenantId },
      select: { externalId: true, channelType: true },
    });
    const channelTypeByExt = new Map(
      channels.map((c) => [c.externalId, c.channelType]),
    );

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
        // Инкрементальный: чаты отсортированы desc по updatedAt — как только
        // встретили старше курсора, дальше можно не идти.
        if (opts?.since && updatedAt < opts.since) {
          stop = true;
          break;
        }

        const chatDbId = await this.upsertChat(
          tenantId,
          apiChat,
          channelTypeByExt,
        );
        await this.syncMessages(tenantId, chatDbId, apiChat.id);
        count += 1;
      }

      page += 1;
      offset += PAGE_SIZE;
    }

    return count;
  }

  /** Upsert одного чата. Возвращает внутренний id. */
  private async upsertChat(
    tenantId: string,
    apiChat: ChatboxApiChat,
    channelTypeByExt: Map<string, string>,
  ): Promise<string> {
    const channelExternalId = apiChat.channelId;
    const channelType = channelTypeByExt.get(channelExternalId) ?? '';

    // customerExternalId резолвим через ChatboxChannelClient по client.id.
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

  // ─────────────────────────── orchestration ───────────────────────

  /** Полный синк всех сущностей. Обновляет lastFullSyncAt. */
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

  /** Инкрементальный синк (чаты — по курсору lastIncrementalSyncAt). */
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
    // Фиксируем курсор НА СТАРТЕ: чаты, обновлённые во время прогона, не
    // будут пропущены на следующем инкременте.
    const startedAt = new Date();

    const row = await this.prisma.chatboxIntegration.findUnique({
      where: { tenantId },
      select: { lastIncrementalSyncAt: true },
    });

    // Справочники малы — синкаем полностью.
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

  /** Синк по scope (ручной триггер из админки). */
  async syncByScope(
    tenantId: string,
    scope: 'all' | 'customers' | 'managers' | 'chats',
  ): Promise<Record<string, number>> {
    switch (scope) {
      case 'all':
        return this.fullSync(tenantId);
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
        const chats = await this.syncChats(tenantId);
        return { chats };
      }
    }
  }

  // ─────────────────────────── enum mapping ────────────────────────

  /**
   * sender.type ChatBox → ChatboxSenderType. Значения совпадают (верхний
   * регистр). sender отсутствует / неизвестный тип → fallback 'CLIENT'.
   */
  private mapSenderType(type: string | null | undefined): ChatboxSenderType {
    const allowed: ChatboxSenderType[] = [
      'CLIENT',
      'USER',
      'ASSISTANT',
      'QUALITY_CONTROL',
    ];
    if (type && allowed.includes(type as ChatboxSenderType)) {
      return type as ChatboxSenderType;
    }
    return 'CLIENT';
  }

  /**
   * content.type ChatBox → ChatboxContentType. Значения совпадают. Отсутствует
   * / неизвестный → fallback 'TEXT'.
   */
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

  /** status ChatBox (ACTIVE|CLOSED) → ChatboxChatStatus ('active'|'closed'). */
  private mapStatus(status: string): ChatboxChatStatus {
    return status.toLowerCase() === 'closed' ? 'closed' : 'active';
  }
}
