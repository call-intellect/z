import { Inject, Injectable } from '@nestjs/common';
import type {
  IdeaBlockStatus,
  InsightDynamic,
  InsightSeverity,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  CORA_FEED_TYPES,
  type CoraFeedItemDto,
  type CoraFeedQuery,
  type CoraFeedResponseDto,
  type CoraFeedTypeDto,
  type CoraSeverityDto,
  type CoraSeenResponseDto,
} from '../dto/activity-feed.dto';

type ConcreteType = Exclude<CoraFeedTypeDto, 'all'>;

/**
 * Сколько РАБОЧИХ дней вопрос (IdeaBlock signalType='question') должен висеть
 * без ответа, чтобы попасть в дорожку `open_question` «Ленты Коры».
 *
 * Детектор работает НА ЧТЕНИИ (без cron/persist): для каждого вопроса
 * считаем число рабочих дней между его `createdAt` и `now`. «Рабочий день» —
 * пн–пт (Sat/Sun исключаются); государственные праздники НЕ учитываются
 * (это упрощение — полноценный календарь живёт в HolidayService и требует
 * запроса в БД на каждую дату, что для чтения ленты неоправданно тяжело).
 */
const OPEN_QUESTION_MIN_BUSINESS_DAYS = 3;

/**
 * Статусы IdeaBlock, при которых вопрос считается «закрытым» (resolved /
 * устаревшим) и НЕ попадает в open_question.
 */
const QUESTION_CLOSED_STATUSES: IdeaBlockStatus[] = [
  'merged_into',
  'archived',
];

/**
 * CoraFeedService — движок единой «Ленты Коры» (Редизайн Ф8.6, 2026-06-13).
 *
 * Гибрид (Р10):
 *   - Реестровые типы читаются ВИРТУАЛЬНО из source-таблиц (без backfill,
 *     без отдельных ActivityFeedItem):
 *       idea          ← IdeaBlock (signalType='idea', canonical)
 *       insight       ← Insight
 *       decision      ← Decision
 *       conflict      ← ConflictItem (status='open')
 *       blocker       ← BlockerSynthesis (status in new|recurring)
 *       open_question ← IdeaBlock (signalType='question'), детектор «≥3 раб.дня
 *                       без ответа» на чтении.
 *   - Событийные типы читаются из ActivityFeedItem:
 *       activity       ← ActivityFeedItem (feedType in recognition|task)
 *       probe_question ← ActivityFeedItem (feedType='probe_question')
 *
 * Карточка несёт АНАЛИЗ (severity → цвет/сортировка), не сырой факт.
 *
 * «Непрочитанное» — per-user курсор FeedReadCursor.lastSeenAt: запись unread,
 * если её createdAt > курсора. POST /feed/cora/seen двигает курсор на now().
 *
 * Multi-tenancy: все запросы scoped по tenantId. RBAC/visibility проверяет
 * контроллер (лента Коры — обзорная, для members tenant'а).
 */
@Injectable()
export class CoraFeedService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ─────────────────────────── публичный API ─────────────────────────────

  async getFeed(args: {
    tenantId: string;
    userId: string;
    query: CoraFeedQuery;
  }): Promise<CoraFeedResponseDto> {
    const { tenantId, userId, query } = args;
    const since = this.windowStart(query.window);
    const cursorAt = await this.loadCursor(tenantId, userId);

    // Какие типы реально собирать: при type='all' — все; иначе один тип.
    const wanted: ConcreteType[] =
      query.type === 'all' ? [...CORA_FEED_TYPES] : [query.type];

    // Собираем по каждому типу параллельно. Каждый сборщик возвращает уже
    // отмапленные CoraFeedItemDto (с unread, посчитанным от курсора).
    const perType = await Promise.all(
      wanted.map((t) => this.collect(t, { tenantId, since, cursorAt, limit: query.limit })),
    );

    // counters считаем всегда по ВСЕМ типам (для бейджей переключателя),
    // независимо от выбранного фильтра.
    const counters = await this.countAll(tenantId, since);

    // Сводим все собранные элементы, сортируем (risk → warn → info, затем по
    // дате убыв.), режем по limit.
    const merged = perType
      .flat()
      .sort((a, b) => {
        const sev = this.severityRank(b.severity) - this.severityRank(a.severity);
        if (sev !== 0) return sev;
        return b.createdAt.localeCompare(a.createdAt);
      })
      .slice(0, query.limit);

    const unreadCount = merged.filter((it) => it.unread).length;

    return { items: merged, counters, unreadCount };
  }

  /** POST /feed/cora/seen — двигает per-user курсор на now(). */
  async markCoraSeen(args: {
    tenantId: string;
    userId: string;
    now?: Date;
  }): Promise<CoraSeenResponseDto> {
    const now = args.now ?? new Date();
    const row = await this.prisma.feedReadCursor.upsert({
      where: { tenantId_userId: { tenantId: args.tenantId, userId: args.userId } },
      create: { tenantId: args.tenantId, userId: args.userId, lastSeenAt: now },
      update: { lastSeenAt: now },
    });
    return { ok: true, lastSeenAt: row.lastSeenAt.toISOString() };
  }

  // ─────────────────────────── сборщики типов ────────────────────────────

  private async collect(
    type: ConcreteType,
    ctx: { tenantId: string; since: Date | null; cursorAt: Date | null; limit: number },
  ): Promise<CoraFeedItemDto[]> {
    switch (type) {
      case 'idea':
        return this.collectIdeas(ctx);
      case 'insight':
        return this.collectInsights(ctx);
      case 'decision':
        return this.collectDecisions(ctx);
      case 'conflict':
        return this.collectConflicts(ctx);
      case 'blocker':
        return this.collectBlockers(ctx);
      case 'open_question':
        return this.collectOpenQuestions(ctx);
      case 'activity':
        return this.collectActivity(ctx);
      case 'probe_question':
        return this.collectProbeQuestions(ctx);
      default: {
        const _exhaustive: never = type;
        return _exhaustive;
      }
    }
  }

  // idea ← IdeaBlock(signalType='idea', canonical) — N упоминаний + связи.
  private async collectIdeas(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: ctx.tenantId,
        signalType: 'idea',
        status: 'canonical',
        ...(ctx.since ? { createdAt: { gte: ctx.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: ctx.limit,
      select: { id: true, name: true, evidenceCount: true, createdAt: true },
    });
    if (blocks.length === 0) return [];

    // Один groupBy на все блоки — число активных связей (как from, так и to).
    const ids = blocks.map((b) => b.id);
    const linkCounts = await this.countBlockLinks(ctx.tenantId, ids);

    return blocks.map((b) => {
      const links = linkCounts.get(b.id) ?? 0;
      const parts: string[] = [`${b.evidenceCount} упоминаний`];
      if (links > 0) parts.push(`${links} связей`);
      return this.item({
        id: `idea:${b.id}`,
        type: 'idea',
        title: b.name,
        analysis: parts.join(' · '),
        severity: 'info',
        createdAt: b.createdAt,
        cursorAt: ctx.cursorAt,
        payload: { ideaBlockId: b.id, evidenceCount: b.evidenceCount, linkCount: links },
      });
    });
  }

  // insight ← Insight — острота→severity, тренд, N за неделю.
  private async collectInsights(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const rows = await this.prisma.insight.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'active',
        ...(ctx.since ? { lastObservedAt: { gte: ctx.since } } : {}),
      },
      orderBy: [{ severity: 'desc' }, { lastObservedAt: 'desc' }],
      take: ctx.limit,
      select: {
        id: true,
        statement: true,
        severity: true,
        dynamicLabel: true,
        mitigationPlan: true,
        createdAt: true,
        lastObservedAt: true,
        sourceBlockIds: true,
      },
    });
    return rows.map((r) => {
      const parts: string[] = [`острота: ${this.insightSeverityLabel(r.severity)}`];
      parts.push(`динамика: ${this.dynamicLabel(r.dynamicLabel)}`);
      parts.push(`упоминаний: ${r.sourceBlockIds.length}`);
      if (r.mitigationPlan && r.mitigationPlan.trim().length > 0) {
        parts.push('есть план реагирования');
      } else {
        parts.push('плана реагирования нет');
      }
      return this.item({
        id: `insight:${r.id}`,
        type: 'insight',
        title: r.statement,
        analysis: parts.join(' · '),
        severity: this.mapInsightSeverity(r.severity),
        createdAt: r.lastObservedAt ?? r.createdAt,
        cursorAt: ctx.cursorAt,
        payload: {
          insightId: r.id,
          severity: r.severity,
          dynamic: r.dynamicLabel,
          hasMitigation: Boolean(r.mitigationPlan && r.mitigationPlan.trim().length > 0),
        },
      });
    });
  }

  // decision ← Decision — % доведения / статус внедрения.
  private async collectDecisions(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const rows = await this.prisma.decision.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { notIn: ['rejected', 'cancelled', 'rolled_back', 'superseded'] },
        ...(ctx.since ? { createdAt: { gte: ctx.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: ctx.limit,
      select: {
        id: true,
        statement: true,
        text: true,
        status: true,
        implementationStatus: true,
        linkedTaskCount: true,
        deadline: true,
        actualOutcomes: true,
        createdAt: true,
      },
    });
    const now = Date.now();
    return rows.map((r) => {
      const title = (r.statement ?? r.text ?? 'Решение').trim();
      const impl = r.implementationStatus ?? 'not_started';
      const parts: string[] = [`статус: ${this.implLabel(impl)}`];
      parts.push(`связанных задач: ${r.linkedTaskCount}`);
      // severity: просроченное невнедрённое или stalled — risk; in_progress — warn; done — info.
      let severity: CoraSeverityDto = 'info';
      const overdue =
        r.deadline != null &&
        r.deadline.getTime() < now &&
        impl !== 'done';
      if (impl === 'stalled' || overdue) {
        severity = 'risk';
        if (overdue) parts.push('срок истёк');
      } else if (impl === 'in_progress' || impl === 'not_started') {
        severity = 'warn';
      }
      return this.item({
        id: `decision:${r.id}`,
        type: 'decision',
        title,
        analysis: parts.join(' · '),
        severity,
        createdAt: r.createdAt,
        cursorAt: ctx.cursorAt,
        payload: {
          decisionId: r.id,
          status: r.status,
          implementationStatus: impl,
          linkedTaskCount: r.linkedTaskCount,
          overdue,
        },
      });
    });
  }

  // conflict ← ConflictItem(status='open') — две версии в payload.
  private async collectConflicts(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const rows = await this.prisma.conflictItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: 'open',
        ...(ctx.since ? { createdAt: { gte: ctx.since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: ctx.limit,
      select: {
        id: true,
        resourceType: true,
        relationType: true,
        evidence: true,
        reasoning: true,
        createdAt: true,
      },
    });
    return rows.map((r) => {
      const versions = this.extractConflictVersions(r.evidence);
      return this.item({
        id: `conflict:${r.id}`,
        type: 'conflict',
        title:
          r.reasoning?.trim() ||
          `Конфликт (${r.resourceType}): ${this.relationLabel(r.relationType)}`,
        analysis: `тип: ${this.relationLabel(r.relationType)} · требует разрешения`,
        severity: 'warn',
        createdAt: r.createdAt,
        cursorAt: ctx.cursorAt,
        payload: {
          conflictId: r.id,
          resourceType: r.resourceType,
          relationType: r.relationType,
          versionA: versions.a,
          versionB: versions.b,
        },
      });
    });
  }

  // blocker ← BlockerSynthesis(status in new|recurring) — title + daysOpen.
  private async collectBlockers(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const rows = await this.prisma.blockerSynthesis.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ['new', 'recurring'] },
        ...(ctx.since ? { updatedAt: { gte: ctx.since } } : {}),
      },
      orderBy: [{ daysOpen: 'desc' }, { updatedAt: 'desc' }],
      take: ctx.limit,
      select: {
        id: true,
        representativeText: true,
        status: true,
        daysOpen: true,
        businessImpactScore: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((r) => {
      const chronic = r.status === 'recurring' || r.daysOpen >= 7;
      const parts: string[] = [`${r.daysOpen} дн. открыт`];
      if (r.status === 'recurring') parts.push('повторяющийся');
      return this.item({
        id: `blocker:${r.id}`,
        type: 'blocker',
        title: r.representativeText,
        analysis: parts.join(' · '),
        severity: chronic ? 'risk' : 'warn',
        createdAt: r.updatedAt ?? r.createdAt,
        cursorAt: ctx.cursorAt,
        payload: {
          blockerId: r.id,
          status: r.status,
          daysOpen: r.daysOpen,
          chronic,
        },
      });
    });
  }

  // open_question ← IdeaBlock(signalType='question') без ответа ≥3 раб.дня.
  private async collectOpenQuestions(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    // Берём с запасом (×3), т.к. часть отсеется детектором «≥3 раб.дня».
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: ctx.tenantId,
        signalType: 'question',
        status: { notIn: QUESTION_CLOSED_STATUSES },
        supersededById: null,
        ...(ctx.since ? { createdAt: { gte: ctx.since } } : {}),
      },
      orderBy: { createdAt: 'asc' }, // самые старые «висящие» — первыми
      take: ctx.limit * 3,
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        createdAt: true,
      },
    });
    const now = new Date();
    // Сначала отбираем «висящие» вопросы детектором, затем ОДНИМ батчем
    // резолвим их авторов и считаем askedByManager (без N+1).
    const surviving = rows
      .map((r) => ({
        r,
        businessDays: CoraFeedService.businessDaysBetween(r.createdAt, now),
      }))
      .filter((x) => x.businessDays >= OPEN_QUESTION_MIN_BUSINESS_DAYS)
      .slice(0, ctx.limit);

    // R9: подсветка «спросил руководитель». Авторство ВОПРОСА не
    // материализовано на IdeaBlock (commitmentAuthorPersonId заполнен только
    // для commitment). Используем сигнал `IdeaBlockEntity(role='subject')`,
    // который block-ingest.attributeSubject пишет для ВСЕХ блоков-рассуждений
    // (включая вопросы): subject-Entity(type=person) → Person → «руководитель».
    const askedByManagerByBlock = await this.resolveAskedByManager(
      ctx.tenantId,
      surviving.map((x) => x.r.id),
    );

    const out: CoraFeedItemDto[] = [];
    for (const { r, businessDays } of surviving) {
      out.push(
        this.item({
          id: `open_question:${r.id}`,
          type: 'open_question',
          title: r.criticalQuestion?.trim() || r.name,
          analysis: `висит ${businessDays} раб. дн. без ответа`,
          severity: businessDays >= OPEN_QUESTION_MIN_BUSINESS_DAYS * 2 ? 'risk' : 'warn',
          createdAt: r.createdAt,
          cursorAt: ctx.cursorAt,
          payload: {
            ideaBlockId: r.id,
            businessDays,
            askedByManager: askedByManagerByBlock.get(r.id) ?? false,
          },
        }),
      );
    }
    return out;
  }

  /**
   * R9 — для пачки вопросов-блоков определяет, является ли АВТОР вопроса
   * «руководителем». Батч-эффективно (4 запроса на всю пачку, без N+1).
   *
   * Цепочка резолва авторства (всё — на материализованных связях, без LLM):
   *   IdeaBlockEntity(role='subject') → Entity(type=person) → Person.
   * Источник subject-связи — block-ingest `attributeSubject` (Фаза 1.2),
   * который пишет автора рассуждения по speakerParticipantId/authorPersonId
   * сегмента-источника. Для вопросов без резолва автора (нет subject-Entity
   * или Entity не привязан к Person) → false (бейдж не показываем, не падаем).
   *
   * «Руководитель» (поля «менеджер» в схеме нет): Person является главой
   * какого-либо отдела (Department.headPersonId == person.id) ИЛИ имеет
   * Membership с ролью owner/admin/coo.
   */
  private async resolveAskedByManager(
    tenantId: string,
    blockIds: string[],
  ): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (blockIds.length === 0) return result;

    // 1. blockId → subject-Entity.id (одна связь role='subject' на блок).
    const subjects = await this.prisma.ideaBlockEntity.findMany({
      where: { blockId: { in: blockIds }, role: 'subject' },
      select: { blockId: true, entityId: true },
    });
    if (subjects.length === 0) return result;
    const blockToEntity = new Map<string, string>();
    for (const s of subjects) {
      if (!blockToEntity.has(s.blockId)) blockToEntity.set(s.blockId, s.entityId);
    }
    const entityIds = [...new Set(blockToEntity.values())];

    // 2. Entity.id → Person.id (subject-Entity линкуется с Person через entityId).
    const persons = await this.prisma.person.findMany({
      where: { tenantId, entityId: { in: entityIds }, deletedAt: null },
      select: { id: true, entityId: true },
    });
    if (persons.length === 0) return result;
    const entityToPerson = new Map<string, string>();
    for (const p of persons) {
      if (p.entityId && !entityToPerson.has(p.entityId)) {
        entityToPerson.set(p.entityId, p.id);
      }
    }
    const personIds = [...new Set(entityToPerson.values())];

    // 3+4. «Руководитель»: глава какого-либо отдела ИЛИ owner/admin/coo.
    const [heads, admins] = await Promise.all([
      this.prisma.department.findMany({
        where: { tenantId, headPersonId: { in: personIds }, deletedAt: null },
        select: { headPersonId: true },
      }),
      this.prisma.membership.findMany({
        where: {
          orgId: tenantId,
          personId: { in: personIds },
          role: { in: ['owner', 'admin', 'coo'] },
        },
        select: { personId: true },
      }),
    ]);
    const managerPersonIds = new Set<string>();
    for (const h of heads) if (h.headPersonId) managerPersonIds.add(h.headPersonId);
    for (const a of admins) if (a.personId) managerPersonIds.add(a.personId);

    // Сводим обратно: blockId → askedByManager.
    for (const [blockId, entityId] of blockToEntity) {
      const personId = entityToPerson.get(entityId);
      if (personId && managerPersonIds.has(personId)) {
        result.set(blockId, true);
      }
    }
    return result;
  }

  // activity ← ActivityFeedItem(feedType in recognition|task) — «кто что сделал».
  private async collectActivity(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const rows = await this.prisma.activityFeedItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        feedType: { in: ['recognition', 'task'] },
        status: { not: 'dismissed' },
        ...(ctx.since ? { emittedAt: { gte: ctx.since } } : {}),
      },
      orderBy: { emittedAt: 'desc' },
      take: ctx.limit,
      select: {
        id: true,
        feedType: true,
        title: true,
        summary: true,
        severity: true,
        emittedAt: true,
        relatedEntityType: true,
        relatedEntityId: true,
      },
    });
    return rows.map((r) =>
      this.item({
        id: `activity:${r.id}`,
        type: 'activity',
        title: r.title,
        analysis: r.summary ?? undefined,
        severity: this.mapFeedSeverity(r.severity),
        createdAt: r.emittedAt,
        cursorAt: ctx.cursorAt,
        payload: {
          feedItemId: r.id,
          kind: r.feedType,
          relatedEntityType: r.relatedEntityType,
          relatedEntityId: r.relatedEntityId,
        },
      }),
    );
  }

  // probe_question ← ActivityFeedItem(feedType='probe_question').
  private async collectProbeQuestions(ctx: {
    tenantId: string;
    since: Date | null;
    cursorAt: Date | null;
    limit: number;
  }): Promise<CoraFeedItemDto[]> {
    const rows = await this.prisma.activityFeedItem.findMany({
      where: {
        tenantId: ctx.tenantId,
        feedType: 'probe_question',
        status: { notIn: ['dismissed', 'expired'] },
        ...(ctx.since ? { emittedAt: { gte: ctx.since } } : {}),
      },
      orderBy: { emittedAt: 'desc' },
      take: ctx.limit,
      select: {
        id: true,
        title: true,
        summary: true,
        status: true,
        severity: true,
        targetUserId: true,
        relatedEntityId: true,
        emittedAt: true,
        respondedAt: true,
      },
    });
    return rows.map((r) =>
      this.item({
        id: `probe_question:${r.id}`,
        type: 'probe_question',
        title: r.title,
        analysis:
          r.status === 'responded'
            ? 'отвечен'
            : r.status === 'seen'
              ? 'прочитан, ждёт ответа'
              : 'ждёт ответа',
        severity: this.mapFeedSeverity(r.severity),
        createdAt: r.emittedAt,
        cursorAt: ctx.cursorAt,
        payload: {
          feedItemId: r.id,
          status: r.status,
          targetUserId: r.targetUserId,
          probeEventId: r.relatedEntityId,
        },
      }),
    );
  }

  // ─────────────────────────── counters ──────────────────────────────────

  /** counters по всем типам за окно (для бейджей). */
  private async countAll(
    tenantId: string,
    since: Date | null,
  ): Promise<Record<ConcreteType, number>> {
    const sinceWhere = since ? { gte: since } : undefined;

    const [
      idea,
      insight,
      decision,
      conflict,
      blocker,
      activity,
      probe,
      openQuestion,
    ] = await Promise.all([
      this.prisma.ideaBlock.count({
        where: {
          tenantId,
          signalType: 'idea',
          status: 'canonical',
          ...(sinceWhere ? { createdAt: sinceWhere } : {}),
        },
      }),
      this.prisma.insight.count({
        where: {
          tenantId,
          status: 'active',
          ...(sinceWhere ? { lastObservedAt: sinceWhere } : {}),
        },
      }),
      this.prisma.decision.count({
        where: {
          tenantId,
          status: { notIn: ['rejected', 'cancelled', 'rolled_back', 'superseded'] },
          ...(sinceWhere ? { createdAt: sinceWhere } : {}),
        },
      }),
      this.prisma.conflictItem.count({
        where: {
          tenantId,
          status: 'open',
          ...(sinceWhere ? { createdAt: sinceWhere } : {}),
        },
      }),
      this.prisma.blockerSynthesis.count({
        where: {
          tenantId,
          status: { in: ['new', 'recurring'] },
          ...(sinceWhere ? { updatedAt: sinceWhere } : {}),
        },
      }),
      this.prisma.activityFeedItem.count({
        where: {
          tenantId,
          feedType: { in: ['recognition', 'task'] },
          status: { not: 'dismissed' },
          ...(sinceWhere ? { emittedAt: sinceWhere } : {}),
        },
      }),
      this.prisma.activityFeedItem.count({
        where: {
          tenantId,
          feedType: 'probe_question',
          status: { notIn: ['dismissed', 'expired'] },
          ...(sinceWhere ? { emittedAt: sinceWhere } : {}),
        },
      }),
      // open_question — точный счёт требует детектора по каждой записи; для
      // counters берём дешёвую верхнюю оценку: все висящие вопросы старше
      // OPEN_QUESTION_MIN_BUSINESS_DAYS календарных дней (раб.дней ≥ кал.дней
      // НЕ бывает, поэтому это нижняя граница; для бейджа достаточно).
      this.prisma.ideaBlock.count({
        where: {
          tenantId,
          signalType: 'question',
          status: { notIn: QUESTION_CLOSED_STATUSES },
          supersededById: null,
          createdAt: {
            lte: CoraFeedService.minusCalendarDays(new Date(), OPEN_QUESTION_MIN_BUSINESS_DAYS),
            ...(sinceWhere ?? {}),
          },
        },
      }),
    ]);

    return {
      idea,
      insight,
      decision,
      conflict,
      blocker,
      activity,
      probe_question: probe,
      open_question: openQuestion,
    };
  }

  // ─────────────────────────── helpers ───────────────────────────────────

  private async loadCursor(
    tenantId: string,
    userId: string,
  ): Promise<Date | null> {
    const row = await this.prisma.feedReadCursor.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: { lastSeenAt: true },
    });
    return row?.lastSeenAt ?? null;
  }

  private async countBlockLinks(
    tenantId: string,
    blockIds: string[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (blockIds.length === 0) return result;
    const [fromGroups, toGroups] = await Promise.all([
      this.prisma.ideaBlockLink.groupBy({
        by: ['fromBlockId'],
        where: { tenantId, status: 'active', fromBlockId: { in: blockIds } },
        _count: { _all: true },
      }),
      this.prisma.ideaBlockLink.groupBy({
        by: ['toBlockId'],
        where: { tenantId, status: 'active', toBlockId: { in: blockIds } },
        _count: { _all: true },
      }),
    ]);
    for (const g of fromGroups) {
      result.set(g.fromBlockId, (result.get(g.fromBlockId) ?? 0) + g._count._all);
    }
    for (const g of toGroups) {
      result.set(g.toBlockId, (result.get(g.toBlockId) ?? 0) + g._count._all);
    }
    return result;
  }

  private item(args: {
    id: string;
    type: ConcreteType;
    title: string;
    analysis?: string;
    severity: CoraSeverityDto;
    createdAt: Date;
    cursorAt: Date | null;
    sourceRef?: { meetingId?: string; cite?: string };
    payload?: Record<string, unknown>;
  }): CoraFeedItemDto {
    const unread =
      args.cursorAt == null || args.createdAt.getTime() > args.cursorAt.getTime();
    return {
      id: args.id,
      type: args.type,
      title: args.title,
      ...(args.analysis !== undefined ? { analysis: args.analysis } : {}),
      severity: args.severity,
      ...(args.sourceRef ? { sourceRef: args.sourceRef } : {}),
      createdAt: args.createdAt.toISOString(),
      unread,
      ...(args.payload ? { payload: args.payload } : {}),
    };
  }

  private windowStart(window: CoraFeedQuery['window']): Date | null {
    if (window === undefined || window === 'all') return null;
    return CoraFeedService.minusCalendarDays(new Date(), window);
  }

  private severityRank(s: CoraSeverityDto): number {
    return s === 'risk' ? 2 : s === 'warn' ? 1 : 0;
  }

  private mapInsightSeverity(s: InsightSeverity): CoraSeverityDto {
    if (s === 'critical' || s === 'high') return 'risk';
    if (s === 'medium') return 'warn';
    return 'info';
  }

  private mapFeedSeverity(s: string | null): CoraSeverityDto {
    if (s === 'critical' || s === 'high') return 'risk';
    if (s === 'normal') return 'info';
    if (s === 'low') return 'info';
    return 'info';
  }

  private insightSeverityLabel(s: InsightSeverity): string {
    return (
      { critical: 'критичная', high: 'высокая', medium: 'средняя', low: 'низкая' }[
        s
      ] ?? String(s)
    );
  }

  private dynamicLabel(d: InsightDynamic): string {
    return (
      {
        growing: 'растёт',
        stable: 'стабильно',
        declining: 'снижается',
        spike: 'всплеск',
      }[d] ?? String(d)
    );
  }

  private implLabel(impl: string): string {
    return (
      {
        not_started: 'не начато',
        in_progress: 'в работе',
        done: 'внедрено',
        stalled: 'застряло',
      }[impl] ?? impl
    );
  }

  private relationLabel(rel: string): string {
    return (
      {
        contradicts: 'противоречие',
        duplicates: 'дубликат',
        supersedes: 'замена',
      }[rel] ?? rel
    );
  }

  /**
   * Достаёт две версии конфликта из JSON-поля evidence. Формат не
   * стандартизирован между источниками — best-effort: ищем поля
   * existing/new, before/after, a/b, old/new или массив [a, b].
   */
  private extractConflictVersions(evidence: unknown): {
    a: string | null;
    b: string | null;
  } {
    if (evidence == null) return { a: null, b: null };
    const toText = (v: unknown): string | null => {
      if (v == null) return null;
      if (typeof v === 'string') return v;
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        for (const k of ['text', 'statement', 'value', 'summary', 'name']) {
          if (typeof o[k] === 'string') return o[k] as string;
        }
        return JSON.stringify(v);
      }
      return String(v);
    };
    if (Array.isArray(evidence)) {
      return { a: toText(evidence[0]), b: toText(evidence[1]) };
    }
    if (typeof evidence === 'object') {
      const o = evidence as Record<string, unknown>;
      const pairs: [string, string][] = [
        ['existing', 'new'],
        ['before', 'after'],
        ['old', 'new'],
        ['a', 'b'],
        ['left', 'right'],
      ];
      for (const [ka, kb] of pairs) {
        if (ka in o || kb in o) {
          return { a: toText(o[ka]), b: toText(o[kb]) };
        }
      }
    }
    return { a: toText(evidence), b: null };
  }

  // ── чистые date-утилиты ──

  /** Date минус N календарных дней (UTC), нормализованный к началу суток. */
  static minusCalendarDays(from: Date, days: number): Date {
    const d = new Date(from.getTime());
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  }

  /**
   * Число ПОЛНЫХ рабочих дней (пн–пт) между `from` и `to`, исключая выходные.
   * Считает по календарным суткам UTC: для каждого дня СТРОГО после дня `from`
   * и не позже дня `to`, если это будний день — +1. Праздники не учитываются.
   *
   * Пример: вопрос задан в пятницу, «сейчас» — следующая пятница → суббота и
   * воскресенье не считаются, получаем 5 рабочих дней.
   */
  static businessDaysBetween(from: Date, to: Date): number {
    if (to.getTime() <= from.getTime()) return 0;
    const startDay = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate(),
    );
    const endDay = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
    let count = 0;
    const DAY_MS = 24 * 60 * 60 * 1000;
    for (let t = startDay + DAY_MS; t <= endDay; t += DAY_MS) {
      const dow = new Date(t).getUTCDay(); // 0=Sun, 6=Sat
      if (dow !== 0 && dow !== 6) count += 1;
    }
    return count;
  }
}
