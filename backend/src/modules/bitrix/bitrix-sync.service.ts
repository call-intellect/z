import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
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
import { BitrixAnalyzeQueueService } from './queue/bitrix-analyze.queue.service';

/**
 * BitrixSyncService — синк данных портала Bitrix24 в зеркальные таблицы Коры
 * (ТЗ plans/tz/2026-06-17-bitrix24-source-sync.md, Ф2). По образцу
 * ChatboxSyncService: сотрудники (IM-участники) → диалоги/сообщения → CRM.
 *
 * Все вызовы REST идут через `BitrixIntegrationService.callApi(List)` —
 * там валидный токен + refresh-on-401. Все запросы/ответы Bitrix типизированы
 * (`bitrix-api.types.ts`, формы сверены с докой). Kill-switch `bitrix.enabled`.
 * Анализ диалогов и мост в knowledge-core — отдельная фаза (Ф4).
 */

/** Bitrix отдаёт значения часто строкой (даже числа) — нормализуем в строку|null. */
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

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
    // Ф4 — после синка ставим анализ закрытых сессий (если analysisEnabled).
    // @Optional — unit-тесты синка без полного DI не падают.
    @Optional()
    @Inject(BitrixAnalyzeQueueService)
    private readonly analyzeQueue?: BitrixAnalyzeQueueService,
  ) {}

  // ─────────────────────────── helpers ──────────────────────────────

  private async isEnabled(): Promise<boolean> {
    return (
      (await this.adminSettings.get<boolean>('bitrix.enabled', true)) ?? true
    );
  }

  private async isNameFuzzyEnabled(): Promise<boolean> {
    return (
      (await this.adminSettings.get<boolean>(
        'bitrix.match.name_fuzzy_enabled',
        true,
      )) ?? true
    );
  }

  /** Подключённая интеграция tenant'а или throw `bitrix_not_configured`. */
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

  /** CRM-поля EMAIL/PHONE приходят массивом `[{VALUE,…}]` — берём первое значение. */
  private firstMultiField(
    v: BitrixCrmMultifield[] | string | null | undefined,
  ): string | null {
    if (Array.isArray(v)) {
      return v.length > 0 ? str(v[0]?.VALUE) : null;
    }
    return str(v);
  }

  // ─────────────────────────── users (сотрудники) ───────────────────

  /**
   * Синк сотрудников портала (`user.get`, пагинация) → `BitrixUser`.
   * Связку (`linkedPersonId`/`linkMode`) в upsert НЕ трогаем — каскад ниже.
   */
  async syncUsers(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const params: BitrixUserGetParams = {};
    const users = await this.integration.callApiList<BitrixUser>(
      row,
      'user.get',
      params,
    );

    const now = new Date();
    for (const u of users) {
      const externalId = str(u.ID);
      if (!externalId) continue;
      const name =
        [str(u.NAME), str(u.LAST_NAME)].filter(Boolean).join(' ').trim() || null;
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

  /**
   * Каскад автосвязки BitrixUser → Person: email (батч, case-insensitive) →
   * имя-fuzzy (за флагом). Ручную связку (`manual`) не трогаем.
   */
  private async autoLinkUsers(tenantId: string): Promise<void> {
    const candidates = await this.prisma.bitrixUser.findMany({
      where: { tenantId, linkMode: { not: 'manual' } },
      select: { id: true, email: true, name: true, linkedPersonId: true },
    });
    if (candidates.length === 0) return;

    const emails = [
      ...new Set(
        candidates.map((c) => c.email?.trim()).filter((e): e is string => !!e),
      ),
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
        await this.prisma.bitrixUser.update({
          where: { id: c.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
        continue;
      }
      if (c.linkedPersonId === null) {
        unlinkedAfterEmail.push({ id: c.id, name: c.name });
      }
    }

    if (unlinkedAfterEmail.length > 0 && (await this.isNameFuzzyEnabled())) {
      for (const row of unlinkedAfterEmail) {
        const name = row.name?.trim();
        if (!name) continue;
        const personId = await this.entityResolution.resolvePersonByHint(
          tenantId,
          name,
        );
        if (!personId) continue;
        await this.prisma.bitrixUser.update({
          where: { id: row.id },
          data: { linkedPersonId: personId, linkMode: 'auto' },
        });
      }
    }
  }

  /** Несопоставленные сотрудники → создаём карточку Person и связываем. */
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

  // ─────────────────────────── IM-диалоги + сообщения ───────────────

  /**
   * Синк недавних IM-диалогов (`im.recent.get`, `result` — массив) + их
   * сообщений (`im.dialog.messages.get`). Для каждого диалога — upsert
   * `BitrixDialog`, сообщения, единая сессия (seq=1) для анализа (Ф4).
   */
  async syncDialogs(tenantId: string): Promise<number> {
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
      await this.syncDialogMessages(tenantId, row, dialog.id, dialogId);
      synced += 1;
    }
    return synced;
  }

  /** Сообщения одного диалога + пересборка единой сессии (seq=1). */
  private async syncDialogMessages(
    tenantId: string,
    row: BitrixIntegration,
    dialogDbId: string,
    dialogExternalId: string,
  ): Promise<void> {
    const params: BitrixImMessagesParams = {
      DIALOG_ID: dialogExternalId,
      LIMIT: 100, // максимум по доке
    };
    const res = await this.integration.callApi<BitrixImMessagesResult>(
      row,
      'im.dialog.messages.get',
      params,
    );
    const messages = res?.messages ?? [];
    if (messages.length === 0) return;

    let lastTs: Date | null = null;
    for (const m of messages) {
      const externalId = str(m.id);
      if (!externalId) continue;
      const ts = m.date ? new Date(m.date) : new Date();
      if (!lastTs || ts > lastTs) lastTs = ts;
      const data = {
        tenantId,
        dialogId: dialogDbId,
        authorExternalId: str(m.author_id),
        authorName: null as string | null, // имя — в result.users[], мапим через BitrixUser
        text: str(m.text),
        externalCreatedAt: ts,
        raw: m as unknown as Prisma.InputJsonValue,
      };
      // sessionId на create НЕ ставим (null) — привязка в rebuildDialogSessions;
      // на update НЕ трогаем, чтобы старое сообщение сохранило свою сессию.
      await this.prisma.bitrixMessage.upsert({
        where: { tenantId_externalId: { tenantId, externalId } },
        create: { externalId, ...data },
        update: { text: data.text, raw: data.raw },
      });
    }

    await this.prisma.bitrixDialog.update({
      where: { id: dialogDbId },
      data: { lastMessageAt: lastTs },
    });
    await this.rebuildDialogSessions(tenantId, dialogDbId);
  }

  /**
   * Нарезка НОВЫХ (`sessionId=null`) сообщений диалога на сессии-сутки — как в
   * ChatBox: новые сообщения с прошлого синка группируем по календарному дню
   * (UTC), на каждый день создаём НОВУЮ ЗАКРЫТУЮ сессию (`endedAt` выставлен) →
   * сразу анализируема (Ф4). Сквозной (бесконечный) диалог не висит открытым:
   * каждый синк закрывает прошедшие сутки. Уже привязанные сообщения и их
   * сессии не трогаем. Идемпотентно (нет новых → no-op).
   */
  private async rebuildDialogSessions(
    tenantId: string,
    dialogId: string,
  ): Promise<void> {
    const fresh = await this.prisma.bitrixMessage.findMany({
      where: { tenantId, dialogId, sessionId: null },
      orderBy: { externalCreatedAt: 'asc' },
      select: { id: true, externalCreatedAt: true },
    });
    if (fresh.length === 0) return;

    const groups = new Map<
      string,
      { startedAt: Date; endedAt: Date; ids: string[] }
    >();
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
          endedAt: g.endedAt, // закрыта сразу → анализируема
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

  // ─────────────────────────── CRM ──────────────────────────────────

  async syncContacts(tenantId: string): Promise<number> {
    if (!(await this.isEnabled())) return 0;
    const row = await this.requireRow(tenantId);
    const params: BitrixCrmListParams = {
      select: ['ID', 'NAME', 'LAST_NAME', 'EMAIL', 'PHONE'],
    };
    const items = await this.integration.callApiList<BitrixCrmContact>(
      row,
      'crm.contact.list',
      params,
    );
    const now = new Date();
    for (const c of items) {
      const externalId = str(c.ID);
      if (!externalId) continue;
      const name =
        [str(c.NAME), str(c.LAST_NAME)].filter(Boolean).join(' ').trim() || null;
      const data = {
        name,
        email: this.firstMultiField(c.EMAIL),
        phone: this.firstMultiField(c.PHONE),
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
    const params: BitrixCrmListParams = { select: ['ID', 'TITLE'] };
    const items = await this.integration.callApiList<BitrixCrmCompany>(
      row,
      'crm.company.list',
      params,
    );
    const now = new Date();
    for (const c of items) {
      const externalId = str(c.ID);
      if (!externalId) continue;
      const data = {
        title: str(c.TITLE),
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
    const params: BitrixCrmListParams = { select: ['ID', 'TITLE', 'STAGE_ID'] };
    const items = await this.integration.callApiList<BitrixCrmDeal>(
      row,
      'crm.deal.list',
      params,
    );
    const now = new Date();
    for (const d of items) {
      const externalId = str(d.ID);
      if (!externalId) continue;
      const data = {
        title: str(d.TITLE),
        stageId: str(d.STAGE_ID),
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

  // ─────────────────────────── оркестрация ──────────────────────────

  async fullSync(tenantId: string): Promise<Record<string, number>> {
    const users = await this.syncUsers(tenantId);
    const dialogs = await this.syncDialogs(tenantId);
    const contacts = await this.syncContacts(tenantId);
    const companies = await this.syncCompanies(tenantId);
    const deals = await this.syncDeals(tenantId);
    await this.markSynced(tenantId, 'full');
    await this.enqueuePendingAnalysisIfEnabled(tenantId);
    return { users, dialogs, contacts, companies, deals };
  }

  /**
   * Ф4 — после синка ставит анализ закрытых сессий-суток (`pending` +
   * `endedAt != null`). Гейт по per-integration `analysisEnabled`: пока выключено
   * — диалоги зеркалятся, но LLM не дёргаем. Дедуп — на уровне jobId BullMQ
   * (`bitrix-analyze-${sessionId}`). Best-effort: ошибки enqueue не валят синк.
   */
  private async enqueuePendingAnalysisIfEnabled(
    tenantId: string,
  ): Promise<void> {
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
  ): Promise<Record<string, number>> {
    switch (scope) {
      case 'all':
        return this.fullSync(tenantId);
      case 'users': {
        const users = await this.syncUsers(tenantId);
        await this.markSynced(tenantId, 'incremental');
        return { users };
      }
      case 'dialogs': {
        const dialogs = await this.syncDialogs(tenantId);
        await this.markSynced(tenantId, 'incremental');
        await this.enqueuePendingAnalysisIfEnabled(tenantId);
        return { dialogs };
      }
      case 'crm': {
        const contacts = await this.syncContacts(tenantId);
        const companies = await this.syncCompanies(tenantId);
        const deals = await this.syncDeals(tenantId);
        await this.markSynced(tenantId, 'incremental');
        return { contacts, companies, deals };
      }
    }
  }

  private async markSynced(
    tenantId: string,
    kind: 'full' | 'incremental',
  ): Promise<void> {
    const now = new Date();
    await this.prisma.bitrixIntegration.updateMany({
      where: { tenantId, status: 'connected' },
      data:
        kind === 'full'
          ? { lastFullSyncAt: now, lastIncrementalSyncAt: now }
          : { lastIncrementalSyncAt: now },
    });
  }
}
