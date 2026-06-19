import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { BitrixIntegration, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminSettingsService } from '../admin/settings/admin-settings.service';
import { EntityResolutionService } from '../knowledge-core/services/entity-resolution.service';
import { PersonsService } from '../persons/services/persons.service';

import type {
  BitrixCrmCompany,
  BitrixCrmContact,
  BitrixCrmDeal,
  BitrixCrmLead,
  BitrixCrmListParams,
  BitrixCrmMultifield,
  BitrixImMessagesParams,
  BitrixImMessagesResult,
  BitrixImRecentItem,
  BitrixImRecentParams,
  BitrixUser,
  BitrixUserGetParams,
} from './bitrix-api.types';
import { BitrixIntegrationService } from './bitrix-integration.service';
import type { BitrixUserDto, BitrixUsersResponseDto } from './dto/bitrix-integration.dto';
import { BitrixAnalyzeQueueService } from './queue/bitrix-analyze.queue.service';

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function parseDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const CRM_BACKFILL_DAYS = 7;

@Injectable()
export class BitrixSyncService {
  private readonly logger = new Logger(BitrixSyncService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BitrixIntegrationService)
    private readonly integration: BitrixIntegrationService,
    @Inject(AdminSettingsService)
    private readonly adminSettings: AdminSettingsService,
    @Inject(EntityResolutionService)
    private readonly entityResolution: EntityResolutionService,
    @Inject(PersonsService) private readonly persons: PersonsService,
    @Optional()
    @Inject(BitrixAnalyzeQueueService)
    private readonly analyzeQueue?: BitrixAnalyzeQueueService,
  ) {}

  private async isEnabled(): Promise<boolean> {
    return (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true;
  }

  private async isNameFuzzyEnabled(): Promise<boolean> {
    return (await this.adminSettings.get<boolean>('bitrix.match.name_fuzzy_enabled', true)) ?? true;
  }

  private async requireRow(tenantId: string): Promise<BitrixIntegration> {
    const row = await this.prisma.bitrixIntegration.findFirst({
      where: { tenantId, status: 'connected' },
      orderBy: { lastConnectedAt: 'desc' },
    });
    if (!row) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'bitrix_not_configured',
          message: 'Портал Bitrix24 не подключён к этой компании',
        },
      });
    }
    return row;
  }

  private firstMultiField(v: BitrixCrmMultifield[] | string | null | undefined): string | null {
    if (Array.isArray(v)) {
      return v.length > 0 ? str(v[0]?.VALUE) : null;
    }
    return str(v);
  }

  async syncUsers(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) {
      this.logger.warn(`syncUsers: bitrix.enabled=false — пропуск (tenant=${tenantId})`);
      return 0;
    }
    const row = await this.requireRow(tenantId);
    const params: BitrixUserGetParams = {};
    this.logger.log(
      `syncUsers: tenant=${tenantId} endpoint=${row.clientEndpoint ?? '-'} ` +
        `scope=${row.scope ?? '-'} → запрос user.get`,
    );
    let users: BitrixUser[];
    try {
      users = await this.integration.callApiList<BitrixUser>(row, 'user.get', params);
    } catch (err) {
      this.logger.error(
        `syncUsers: user.get УПАЛ tenant=${tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
    this.logger.log(
      `syncUsers: user.get вернул ${users.length} пользователей (tenant=${tenantId})` +
        (users.length
          ? ` — ID: [${users
              .slice(0, 10)
              .map((u) => str(u.ID))
              .join(',')}]`
          : ''),
    );

    const now = new Date();
    for (const u of users) {
      const externalId = str(u.ID);
      if (!externalId) continue;
      const name = [str(u.NAME), str(u.LAST_NAME)].filter(Boolean).join(' ').trim() || null;
      const data = {
        email: str(u.EMAIL),
        name,
        position: str(u.WORK_POSITION),
        active: u.ACTIVE !== false,
        raw: u as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.bitrixUser.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { tenantId, externalId, ...data },
        update: data,
      });
    }

    await this.autoLinkUsers(tenantId);
    await this.autoCreateUsersUnlinked(tenantId);
    return users.length;
  }

  private async autoLinkUsers(tenantId: string): Promise<void> {
    const candidates = await this.prisma.bitrixUser.findMany({
      where: { tenantId, linkMode: { not: 'manual' } },
      select: { id: true, email: true, name: true, linkedPersonId: true },
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

    const usedPersonIds = new Set<string>();
    const unlinkedAfterEmail: { id: string; name: string | null }[] = [];
    for (const c of candidates) {
      const key = c.email?.trim().toLowerCase();
      const personId = key ? personByEmail.get(key) : undefined;
      if (personId) {
        if (c.linkedPersonId === personId) {
          usedPersonIds.add(personId);
          continue;
        }
        await this.prisma.bitrixUser.update({
          where: { id: c.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
        await this.upgradePersonToEmployee(tenantId, personId);
        usedPersonIds.add(personId);
        continue;
      }
      if (c.linkedPersonId === null) {
        unlinkedAfterEmail.push({ id: c.id, name: c.name });
      } else {
        usedPersonIds.add(c.linkedPersonId);
      }
    }

    if (unlinkedAfterEmail.length > 0 && (await this.isNameFuzzyEnabled())) {
      for (const row of unlinkedAfterEmail) {
        const name = row.name?.trim();
        if (!name) continue;
        const personId = await this.entityResolution.resolvePersonByHint(tenantId, name);
        if (!personId) continue;
        if (usedPersonIds.has(personId)) continue;
        await this.prisma.bitrixUser.update({
          where: { id: row.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
        await this.upgradePersonToEmployee(tenantId, personId);
        usedPersonIds.add(personId);
      }
    }
  }

  private async upgradePersonToEmployee(tenantId: string, personId: string): Promise<void> {
    await this.prisma.person.updateMany({
      where: { id: personId, tenantId, relationship: 'external', deletedAt: null },
      data: { relationship: 'employee' },
    });
  }

  private async autoCreateUsersUnlinked(tenantId: string): Promise<void> {
    const ownerUserId = await this.resolveOwnerUserId(tenantId);
    if (!ownerUserId) return;
    const rows = await this.prisma.bitrixUser.findMany({
      where: { tenantId, linkedPersonId: null, linkMode: { not: 'manual' } },
      select: { id: true, email: true, name: true },
    });
    for (const r of rows) {
      const email = r.email?.trim() || null;
      const name = r.name?.trim() || null;
      if (!email && !name) continue;
      try {
        let personId: string | null = null;
        if (email) {
          const existing = await this.prisma.person.findFirst({
            where: { tenantId, email, deletedAt: null },
            select: { id: true },
          });
          personId = existing?.id ?? null;
        }
        if (!personId) {
          const created = await this.persons.create({
            tenantId,
            userId: ownerUserId,
            body: { name: name ?? email ?? 'Без имени', ...(email ? { email } : {}) },
          });
          personId = created.id;
        }
        await this.upgradePersonToEmployee(tenantId, personId);
        await this.prisma.bitrixUser.update({
          where: { id: r.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
      } catch (err) {
        this.logger.warn(
          { rowId: r.id, err: err instanceof Error ? err.message : String(err) },
          'bitrix autoCreate: не удалось создать/связать — пропуск',
        );
      }
    }
  }

  private async resolveOwnerUserId(tenantId: string): Promise<string | null> {
    const owner = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, role: 'owner' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }

  async syncDialogs(tenantId: string, since?: Date): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const params: BitrixImRecentParams = {};
    const items = await this.integration.callApi<BitrixImRecentItem[]>(
      row,
      'im.recent.get',
      params,
    );
    const list = Array.isArray(items) ? items : [];

    let synced = 0;
    for (const item of list) {
      const dialogId = str(item.id);
      if (!dialogId) continue;
      const type: 'private' | 'chat' = item.type === 'user' ? 'private' : 'chat';
      const title = str(item.title);
      const dialog = await this.prisma.bitrixDialog.upsert({
        where: { tenantId_externalId: { tenantId, externalId: dialogId } },
        create: {
          tenantId,
          externalId: dialogId,
          type,
          title,
          raw: item as unknown as Prisma.InputJsonValue,
        },
        update: {
          title,
          raw: item as unknown as Prisma.InputJsonValue,
          syncedAt: new Date(),
        },
      });
      await this.syncDialogMessages(tenantId, row, dialog.id, dialogId, since);
      synced += 1;
    }
    return synced;
  }

  private static readonly DIALOG_BACKFILL_MAX_PAGES = 25;
  private static readonly DIALOG_BACKFILL_PAGE_SIZE = 200;

  private async syncDialogMessages(
    tenantId: string,
    row: BitrixIntegration,
    dialogDbId: string,
    dialogExternalId: string,
    since?: Date,
  ): Promise<void> {
    const limit = since ? BitrixSyncService.DIALOG_BACKFILL_PAGE_SIZE : 100;
    const maxPages = since ? BitrixSyncService.DIALOG_BACKFILL_MAX_PAGES : 1;

    let lastId: number | undefined;
    let lastTs: Date | null = null;
    let upserted = false;

    for (let page = 0; page < maxPages; page += 1) {
      const params: BitrixImMessagesParams = {
        DIALOG_ID: dialogExternalId,
        LIMIT: limit,
      };
      if (lastId !== undefined) params.LAST_ID = lastId;

      const res = await this.integration.callApi<BitrixImMessagesResult>(
        row,
        'im.dialog.messages.get',
        params,
      );
      const messages = res?.messages ?? [];
      if (messages.length === 0) break;

      let minId: number | null = null;
      let reachedSince = false;
      for (const m of messages) {
        const externalId = str(m.id);
        if (!externalId) continue;
        const idNum = typeof m.id === 'number' ? m.id : Number(m.id);
        if (Number.isFinite(idNum)) minId = minId === null ? idNum : Math.min(minId, idNum);
        const ts = m.date ? new Date(m.date) : new Date();
        if (since && ts < since) {
          reachedSince = true;
          continue;
        }
        if (!lastTs || ts > lastTs) lastTs = ts;
        const data = {
          tenantId,
          dialogId: dialogDbId,
          authorExternalId: str(m.author_id),
          authorName: null as string | null,
          text: str(m.text),
          externalCreatedAt: ts,
          raw: m as unknown as Prisma.InputJsonValue,
        };
        await this.prisma.bitrixMessage.upsert({
          where: { tenantId_externalId: { tenantId, externalId } },
          create: { externalId, ...data },
          update: { text: data.text, raw: data.raw },
        });
        upserted = true;
      }

      if (reachedSince || messages.length < limit || minId === null) break;
      lastId = minId;
    }

    if (upserted) {
      await this.prisma.bitrixDialog.update({
        where: { id: dialogDbId },
        data: { lastMessageAt: lastTs },
      });
    }
    await this.rebuildDialogSessions(tenantId, dialogDbId);
  }

  private async rebuildDialogSessions(tenantId: string, dialogId: string): Promise<void> {
    const fresh = await this.prisma.bitrixMessage.findMany({
      where: { tenantId, dialogId, sessionId: null },
      orderBy: { externalCreatedAt: 'asc' },
      select: { id: true, externalCreatedAt: true },
    });
    if (fresh.length === 0) return;

    const groups = new Map<string, { startedAt: Date; endedAt: Date; ids: string[] }>();
    for (const m of fresh) {
      const dayKey = m.externalCreatedAt.toISOString().slice(0, 10);
      const g = groups.get(dayKey);
      if (g) {
        g.endedAt = m.externalCreatedAt;
        g.ids.push(m.id);
      } else {
        groups.set(dayKey, {
          startedAt: m.externalCreatedAt,
          endedAt: m.externalCreatedAt,
          ids: [m.id],
        });
      }
    }

    const agg = await this.prisma.bitrixDialogSession.aggregate({
      where: { tenantId, dialogId },
      _max: { seq: true },
    });
    let seq = agg._max.seq ?? 0;

    for (const g of groups.values()) {
      seq += 1;
      const session = await this.prisma.bitrixDialogSession.create({
        data: {
          tenantId,
          dialogId,
          seq,
          startedAt: g.startedAt,
          endedAt: g.endedAt,
          messageCount: g.ids.length,
          analysisStatus: 'pending',
        },
        select: { id: true },
      });
      await this.prisma.bitrixMessage.updateMany({
        where: { tenantId, id: { in: g.ids } },
        data: { sessionId: session.id },
      });
    }
  }

  private crmListParams(row: BitrixIntegration, select: string[]): BitrixCrmListParams {
    const since =
      row.lastCrmSyncAt ?? new Date(Date.now() - CRM_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    return {
      select: [...select, 'DATE_MODIFY'],
      filter: { '>=DATE_MODIFY': since.toISOString() },
    };
  }

  async syncContacts(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const items = await this.integration.callApiList<BitrixCrmContact>(
      row,
      'crm.contact.list',
      this.crmListParams(row, ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PHONE']),
    );
    const now = new Date();
    for (const c of items) {
      const externalId = str(c.ID);
      if (!externalId) continue;
      const name = [str(c.NAME), str(c.LAST_NAME)].filter(Boolean).join(' ').trim() || null;
      const data = {
        name,
        email: this.firstMultiField(c.EMAIL),
        phone: this.firstMultiField(c.PHONE),
        modifiedAt: parseDate(c.DATE_MODIFY),
        raw: c as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.bitrixContact.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { tenantId, externalId, ...data },
        update: data,
      });
    }
    return items.length;
  }

  async syncCompanies(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const items = await this.integration.callApiList<BitrixCrmCompany>(
      row,
      'crm.company.list',
      this.crmListParams(row, ['ID', 'TITLE']),
    );
    const now = new Date();
    for (const c of items) {
      const externalId = str(c.ID);
      if (!externalId) continue;
      const data = {
        title: str(c.TITLE),
        modifiedAt: parseDate(c.DATE_MODIFY),
        raw: c as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.bitrixCompany.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { tenantId, externalId, ...data },
        update: data,
      });
    }
    return items.length;
  }

  async syncDeals(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const items = await this.integration.callApiList<BitrixCrmDeal>(
      row,
      'crm.deal.list',
      this.crmListParams(row, ['ID', 'TITLE', 'STAGE_ID']),
    );
    const now = new Date();
    for (const d of items) {
      const externalId = str(d.ID);
      if (!externalId) continue;
      const data = {
        title: str(d.TITLE),
        stageId: str(d.STAGE_ID),
        modifiedAt: parseDate(d.DATE_MODIFY),
        raw: d as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.bitrixDeal.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { tenantId, externalId, ...data },
        update: data,
      });
    }
    return items.length;
  }

  async syncLeads(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const items = await this.integration.callApiList<BitrixCrmLead>(
      row,
      'crm.lead.list',
      this.crmListParams(row, ['ID', 'TITLE', 'NAME', 'LAST_NAME', 'STATUS_ID']),
    );
    const now = new Date();
    for (const l of items) {
      const externalId = str(l.ID);
      if (!externalId) continue;
      const name = [str(l.NAME), str(l.LAST_NAME)].filter(Boolean).join(' ').trim() || null;
      const data = {
        title: str(l.TITLE),
        name,
        statusId: str(l.STATUS_ID),
        modifiedAt: parseDate(l.DATE_MODIFY),
        raw: l as unknown as Prisma.InputJsonValue,
        syncedAt: now,
      };
      await this.prisma.bitrixLead.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { tenantId, externalId, ...data },
        update: data,
      });
    }
    return items.length;
  }

  private async syncCrm(tenantId: string): Promise<Record<string, number>> {
    const cursor = new Date(Date.now() - 60_000);
    const contacts = await this.syncContacts(tenantId);
    const companies = await this.syncCompanies(tenantId);
    const deals = await this.syncDeals(tenantId);
    const leads = await this.syncLeads(tenantId);
    await this.prisma.bitrixIntegration.updateMany({
      where: { tenantId, status: 'connected' },
      data: { lastCrmSyncAt: cursor },
    });
    return { contacts, companies, deals, leads };
  }

  async fullSync(tenantId: string): Promise<Record<string, number>> {
    const users = await this.syncUsers(tenantId);
    const dialogs = await this.syncDialogs(tenantId);
    const crm = await this.syncCrm(tenantId);
    await this.markSynced(tenantId, 'full');
    await this.enqueuePendingAnalysisIfEnabled(tenantId);
    return { users, dialogs, ...crm };
  }

  private async enqueuePendingAnalysisIfEnabled(tenantId: string): Promise<void> {
    if (!this.analyzeQueue) return;
    const integ = await this.prisma.bitrixIntegration.findFirst({
      where: { tenantId, status: 'connected' },
      select: { analysisEnabled: true },
    });
    if (!integ?.analysisEnabled) return;

    const sessions = await this.prisma.bitrixDialogSession.findMany({
      where: { tenantId, analysisStatus: 'pending', endedAt: { not: null } },
      select: { id: true },
      take: 500,
      orderBy: { endedAt: 'asc' },
    });
    for (const s of sessions) {
      try {
        await this.analyzeQueue.enqueue(tenantId, s.id);
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            sessionId: s.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'bitrix sync: не удалось поставить анализ — пропуск',
        );
      }
    }
  }

  async syncByScope(
    tenantId: string,
    scope: 'all' | 'users' | 'dialogs' | 'crm',
    since?: string,
  ): Promise<Record<string, number>> {
    const sinceDate =
      since && !Number.isNaN(new Date(since).getTime()) ? new Date(since) : undefined;
    switch (scope) {
      case 'all':
        return this.fullSync(tenantId);
      case 'users': {
        const users = await this.syncUsers(tenantId);
        await this.markSynced(tenantId, 'incremental');
        return { users };
      }
      case 'dialogs': {
        const dialogs = await this.syncDialogs(tenantId, sinceDate);
        await this.markSynced(tenantId, 'incremental');
        await this.enqueuePendingAnalysisIfEnabled(tenantId);
        return { dialogs };
      }
      case 'crm': {
        const crm = await this.syncCrm(tenantId);
        await this.markSynced(tenantId, 'incremental');
        return crm;
      }
    }
  }

  private async markSynced(tenantId: string, kind: 'full' | 'incremental'): Promise<void> {
    const now = new Date();
    await this.prisma.bitrixIntegration.updateMany({
      where: { tenantId, status: 'connected' },
      data:
        kind === 'full'
          ? { lastFullSyncAt: now, lastIncrementalSyncAt: now }
          : { lastIncrementalSyncAt: now },
    });
  }

  async listUsers(tenantId: string): Promise<BitrixUsersResponseDto> {
    const users = await this.prisma.bitrixUser.findMany({
      where: { tenantId },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      select: {
        externalId: true,
        name: true,
        email: true,
        position: true,
        active: true,
        linkMode: true,
        linkedPersonId: true,
      },
    });

    const linkedIds = [
      ...new Set(users.map((u) => u.linkedPersonId).filter((id): id is string => id !== null)),
    ];
    const nameById = new Map<string, string | null>();
    if (linkedIds.length > 0) {
      const linked = await this.prisma.person.findMany({
        where: { tenantId, id: { in: linkedIds } },
        select: { id: true, name: true },
      });
      for (const p of linked) nameById.set(p.id, p.name);
    }

    const personCandidates = await this.prisma.person.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      take: 500,
      select: { id: true, name: true, email: true },
    });

    return {
      users: users.map((u) => ({
        ...u,
        linkedPersonName: u.linkedPersonId ? (nameById.get(u.linkedPersonId) ?? null) : null,
      })),
      personCandidates,
    };
  }

  async linkUser(
    tenantId: string,
    externalId: string,
    mode: 'link' | 'unlink' | 'create',
    personId?: string,
  ): Promise<BitrixUserDto> {
    const user = await this.prisma.bitrixUser.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
      select: { id: true, name: true, email: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'bitrix_user_not_found',
          message: 'Сотрудник Bitrix24 не найден',
        },
      });
    }

    let linkedPersonId: string | null = null;
    if (mode === 'link') {
      const p = await this.prisma.person.findFirst({
        where: { id: personId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!p) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'person_not_found',
            message: 'Сотрудник (Person) не найден в этой компании',
          },
        });
      }
      linkedPersonId = p.id;
    } else if (mode === 'create') {
      const ownerUserId = await this.resolveOwnerUserId(tenantId);
      if (!ownerUserId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'no_owner',
            message: 'Не найден владелец компании для создания карточки',
          },
        });
      }
      const email = user.email?.trim() || null;
      let foundPersonId: string | null = null;
      if (email) {
        const existing = await this.prisma.person.findFirst({
          where: { tenantId, email: { equals: email, mode: 'insensitive' }, deletedAt: null },
          select: { id: true },
        });
        foundPersonId = existing?.id ?? null;
      }
      if (foundPersonId) {
        linkedPersonId = foundPersonId;
      } else {
        const created = await this.persons.create({
          tenantId,
          userId: ownerUserId,
          body: {
            name: user.name?.trim() || email || 'Без имени',
            ...(email ? { email } : {}),
          },
        });
        linkedPersonId = created.id;
      }
    }

    const updated = await this.prisma.bitrixUser.update({
      where: { id: user.id },
      data: { linkedPersonId, linkMode: mode === 'unlink' ? 'none' : 'manual' },
      select: {
        externalId: true,
        name: true,
        email: true,
        position: true,
        active: true,
        linkMode: true,
        linkedPersonId: true,
      },
    });

    let linkedPersonName: string | null = null;
    if (updated.linkedPersonId) {
      const p = await this.prisma.person.findFirst({
        where: { id: updated.linkedPersonId, tenantId },
        select: { name: true },
      });
      linkedPersonName = p?.name ?? null;
    }
    return { ...updated, linkedPersonName };
  }
}
