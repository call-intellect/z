import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  buildPersonalBriefFallbackHint,
  buildPersonalBriefHintUserMessage,
  PERSONAL_BRIEF_HINT_SYSTEM_PROMPT,
  PERSONAL_BRIEF_HINT_TASK_TYPE,
  type PersonalBriefHintPromptInput,
} from '../prompts/personal-brief-hint.prompt';

import { KnowsWhoService } from './knows-who.service';
import {
  dedupBriefItems,
  dropPromisesThatBecameTasks,
  type BriefInsightCoOccurrence,
  type BriefItem,
  type BriefKnowsWhoHint,
  type PersonalDailyBriefPayload,
} from './personal-daily-brief.synth';

/**
 * TZ-1 Фаза 2 (daily-value-engine) — PersonalDailyBriefService.
 *
 * Синтезирует утренний персональный бриф «Твой день»:
 *   - Задачи (Issue/Task), назначенные на меня, due today/overdue.
 *   - Мои обещания (IdeaBlock commitment, commitmentAuthorPersonId=я),
 *     срок сегодня/просроченные.
 *   - Открытые блокеры, автором которых являюсь я.
 *   - Обещания, данные МНЕ (commitmentRecipientPersonId=я).
 *   - 1 подсказка дня (LLM `personal-brief-hint` + детерминированный fallback).
 *   - skill-помощь «кто знает X» по открытому блокеру (KnowsWhoService).
 *
 * Дедуп при объединении источников — чистые функции `dedupBriefItems` /
 * `dropPromisesThatBecameTasks` (обещание-ставшее-задачей считается один раз).
 * Бриф преимущественно структурный (SQL+шаблон); LLM только на подсказку.
 *
 * Пороги/флаги — AdminSetting через getDynamic, не код.
 */
@Injectable()
export class PersonalDailyBriefService {
  private readonly logger = new Logger(PersonalDailyBriefService.name);

  private static readonly MAX_ITEMS = 25;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowsWhoService) private readonly knowsWho: KnowsWhoService,
  ) {}

  /**
   * Собрать payload персонального брифа за `dateLocal`. НЕ персистит (это делает
   * cron upsert'ом). Чистый синтез из БД + дедуп + 1 подсказка.
   */
  async buildFor(args: {
    tenantId: string;
    personId: string;
    dateLocal: string;
  }): Promise<PersonalDailyBriefPayload> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, id: args.personId },
      select: { id: true, userId: true, entityId: true },
    });
    const userId = person?.userId ?? null;

    const dayEnd = this.endOfDayUtc(args.dateLocal);

    // 1. Задачи: Issue (assignee через IssueAssignee.userId) + Task
    //    (assigneeUserId), due today/overdue, открытые.
    const myTasksRaw = userId
      ? await this.collectMyTasks({
          tenantId: args.tenantId,
          userId,
          dayEnd,
        })
      : [];

    // 2. Мои обещания (commitmentAuthorPersonId=я), срок ≤ конец дня, открытые.
    const myPromisesRaw = await this.collectMyPromises({
      tenantId: args.tenantId,
      personId: args.personId,
      dayEnd,
    });

    // 3. Открытые блокеры, автором которых являюсь я.
    const myBlockersRaw = await this.collectMyBlockers({
      tenantId: args.tenantId,
      personId: args.personId,
    });

    // 4. Обещания, данные МНЕ (commitmentRecipientPersonId=я), открытые.
    const promisedToMeRaw = await this.collectPromisedToMe({
      tenantId: args.tenantId,
      personId: args.personId,
    });

    // Дедуп внутри каждого вида + кросс-вид (обещание-ставшее-задачей).
    const myTasks = dedupBriefItems(myTasksRaw).slice(
      0,
      PersonalDailyBriefService.MAX_ITEMS,
    );
    const myPromisesDeduped = dedupBriefItems(myPromisesRaw);
    const myPromises = dropPromisesThatBecameTasks({
      tasks: myTasks,
      promises: myPromisesDeduped,
    }).slice(0, PersonalDailyBriefService.MAX_ITEMS);
    const myBlockers = dedupBriefItems(myBlockersRaw).slice(
      0,
      PersonalDailyBriefService.MAX_ITEMS,
    );
    const promisedToMe = dedupBriefItems(promisedToMeRaw).slice(
      0,
      PersonalDailyBriefService.MAX_ITEMS,
    );

    // 5. skill-помощь «кто знает X» по первому открытому блокеру.
    const knowsWho = await this.resolveKnowsWhoHint({
      tenantId: args.tenantId,
      selfPersonId: args.personId,
      blockers: myBlockers,
    });

    // 5b. TZ-1 Ф4.B — «ты не один»: коллеги уперлись в ту же тему (инсайт).
    const insightCoOccurrence = await this.resolveInsightCoOccurrence({
      tenantId: args.tenantId,
      personId: args.personId,
      personEntityId: person?.entityId ?? null,
    });

    // 6. 1 подсказка дня (LLM + fallback).
    const overdueTaskCount = myTasks.filter((t) => t.overdue).length;
    const hintInput: PersonalBriefHintPromptInput = {
      taskCount: myTasks.length,
      overdueTaskCount,
      promiseCount: myPromises.length,
      blockerCount: myBlockers.length,
      promisedToMeCount: promisedToMe.length,
      topTaskTitles: myTasks.slice(0, 3).map((t) => t.title),
      topBlockerTexts: myBlockers.slice(0, 2).map((b) => b.title),
      knowsWhoExpertName: knowsWho?.expertName ?? null,
    };
    const hint = await this.buildHint(args.tenantId, hintInput);

    return {
      dateLocal: args.dateLocal,
      myTasks,
      myPromises,
      myBlockers,
      promisedToMe,
      hint,
      knowsWho,
      insightCoOccurrence,
      counts: {
        tasks: myTasks.length,
        promises: myPromises.length,
        blockers: myBlockers.length,
        promisedToMe: promisedToMe.length,
      },
    };
  }

  /** Есть ли в брифе хоть что-то стоящее push'а (иначе утром не спамим). */
  hasContent(payload: PersonalDailyBriefPayload): boolean {
    return (
      payload.counts.tasks > 0 ||
      payload.counts.promises > 0 ||
      payload.counts.blockers > 0 ||
      payload.counts.promisedToMe > 0
    );
  }

  // ──────────────────────────── collectors ────────────────────────────

  private async collectMyTasks(args: {
    tenantId: string;
    userId: string;
    dayEnd: Date;
  }): Promise<BriefItem[]> {
    const out: BriefItem[] = [];

    // Issue (трекер): assignee через IssueAssignee, открытые (state.category НЕ
    // completed/cancelled), due ≤ конец дня (today/overdue) ИЛИ без срока но
    // просроченные не попадут — берём только с dueDate ≤ dayEnd.
    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        archivedAt: null,
        assignees: { some: { userId: args.userId } },
        dueDate: { lte: args.dayEnd },
        OR: [
          { state: null },
          { state: { category: { notIn: ['completed', 'cancelled'] } } },
        ],
      },
      select: {
        id: true,
        title: true,
        identifier: true,
        dueDate: true,
      },
      orderBy: [{ dueDate: 'asc' }],
      take: PersonalDailyBriefService.MAX_ITEMS,
    });
    for (const i of issues) {
      out.push({
        kind: 'task',
        dedupKey: i.id,
        title: `${i.identifier}: ${i.title}`.slice(0, 200),
        dueDateIso: i.dueDate ? i.dueDate.toISOString() : null,
        overdue: this.isOverdue(i.dueDate, args.dayEnd),
        priority: 10, // задача из трекера — самый «явный» источник
      });
    }

    // Task (legacy, из встреч): assigneeUserId, открытые, due ≤ конец дня.
    const tasks = await this.prisma.task.findMany({
      where: {
        tenantId: args.tenantId,
        assigneeUserId: args.userId,
        status: { not: 'done' },
        dueDate: { lte: args.dayEnd },
      },
      select: { id: true, title: true, dueDate: true, evidenceBlockIds: true },
      orderBy: [{ dueDate: 'asc' }],
      take: PersonalDailyBriefService.MAX_ITEMS,
    });
    for (const t of tasks) {
      // Если задача порождена блоком (commitment) — дедуп-ключ = sourceBlockId,
      // чтобы схлопнуть с «моим обещанием» того же блока.
      const dedupKey =
        Array.isArray(t.evidenceBlockIds) && t.evidenceBlockIds.length > 0
          ? t.evidenceBlockIds[0]!
          : t.id;
      out.push({
        kind: 'task',
        dedupKey,
        title: t.title.slice(0, 200),
        dueDateIso: t.dueDate ? t.dueDate.toISOString() : null,
        overdue: this.isOverdue(t.dueDate, args.dayEnd),
        priority: 10,
      });
    }

    return out;
  }

  private async collectMyPromises(args: {
    tenantId: string;
    personId: string;
    dayEnd: Date;
  }): Promise<BriefItem[]> {
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentAuthorPersonId: args.personId,
        commitmentStatus: { in: ['open', 'asked'] },
        commitmentDueDate: { lte: args.dayEnd },
      },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        commitmentDueDate: true,
        commitmentRecipient: { select: { name: true } },
      },
      orderBy: [{ commitmentDueDate: 'asc' }],
      take: PersonalDailyBriefService.MAX_ITEMS,
    });
    return blocks.map((b) => ({
      kind: 'my_promise' as const,
      dedupKey: b.id,
      title: (b.name || b.criticalQuestion || 'Обещание').slice(0, 200),
      dueDateIso: b.commitmentDueDate ? b.commitmentDueDate.toISOString() : null,
      overdue: this.isOverdue(b.commitmentDueDate, args.dayEnd),
      priority: 50,
      counterpartyName: b.commitmentRecipient?.name ?? null,
    }));
  }

  private async collectMyBlockers(args: {
    tenantId: string;
    personId: string;
  }): Promise<BriefItem[]> {
    // Блокеры автора: signalType ∈ {blocker, knowledge_gap}, не архив, не
    // superseded. Авторство — через commitmentAuthorPersonId (детерминированная
    // identity спикера; для blocker/knowledge_gap оно тоже проставляется
    // резолвером subject, см. ТЗ Ф2 «открытые блокеры автора»).
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: { in: ['blocker', 'knowledge_gap'] },
        commitmentAuthorPersonId: args.personId,
        status: { not: 'archived' },
        supersededById: null,
        mergedIntoId: null,
      },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: PersonalDailyBriefService.MAX_ITEMS,
    });
    return blocks.map((b) => ({
      kind: 'blocker' as const,
      dedupKey: b.id,
      title: (b.name || b.criticalQuestion || 'Блокер').slice(0, 200),
      dueDateIso: null,
      overdue: false,
      priority: 30,
    }));
  }

  private async collectPromisedToMe(args: {
    tenantId: string;
    personId: string;
  }): Promise<BriefItem[]> {
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentRecipientPersonId: args.personId,
        commitmentStatus: { in: ['open', 'asked'] },
      },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        commitmentDueDate: true,
        commitmentAuthor: { select: { name: true } },
      },
      orderBy: [{ commitmentDueDate: 'asc' }],
      take: PersonalDailyBriefService.MAX_ITEMS,
    });
    return blocks.map((b) => ({
      kind: 'promised_to_me' as const,
      dedupKey: b.id,
      title: (b.name || b.criticalQuestion || 'Обещание').slice(0, 200),
      dueDateIso: b.commitmentDueDate ? b.commitmentDueDate.toISOString() : null,
      overdue: false,
      priority: 60,
      counterpartyName: b.commitmentAuthor?.name ?? null,
    }));
  }

  // ──────────────────────────── knows-who ─────────────────────────────

  /**
   * Skill-помощь по первому открытому блокеру: ищем носителя (исключая автора —
   * самого сотрудника). Возвращает hint-структуру для payload или null.
   */
  private async resolveKnowsWhoHint(args: {
    tenantId: string;
    selfPersonId: string;
    blockers: readonly BriefItem[];
  }): Promise<BriefKnowsWhoHint | null> {
    const firstBlocker = args.blockers[0];
    if (!firstBlocker) return null;
    try {
      const experts = await this.knowsWho.findExpertsForBlocker({
        tenantId: args.tenantId,
        blockId: firstBlocker.dedupKey,
        excludePersonId: args.selfPersonId,
        topK: 1,
      });
      const top = experts[0];
      if (!top) return null;
      return {
        blockId: firstBlocker.dedupKey,
        blockerText: firstBlocker.title,
        expertPersonId: top.personId,
        expertName: top.name,
        confidence: top.confidence,
      };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'personal-daily-brief: knows-who hint упал — без подсказки',
      );
      return null;
    }
  }

  // ──────────────────────────── insight co-occurrence ─────────────────

  /**
   * TZ-1 Ф4.B — «ты не один»: ищем активный инсайт, в `personSubjectIds`
   * которого упомянут этот сотрудник, и считаем сколько коллег (Person)
   * затронуто той же темой. Эскалация — severity high/critical ИЛИ
   * dynamicLabel=spike. Возвращает топ-1 (по числу коллег) или null.
   *
   * Цель — встроить «4 коллеги сегодня уперлись в то же» прямо в бриф (без
   * отдельного пуша → без спама). Best-effort: на ошибке возвращаем null.
   */
  private async resolveInsightCoOccurrence(args: {
    tenantId: string;
    personId: string;
    personEntityId: string | null;
  }): Promise<BriefInsightCoOccurrence | null> {
    if (!args.personEntityId) return null;
    try {
      const insights = await this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          status: { in: ['active', 'mitigating'] },
          personSubjectIds: { has: args.personEntityId },
        },
        select: {
          id: true,
          statement: true,
          severity: true,
          dynamicLabel: true,
          personSubjectIds: true,
        },
        take: 25,
      });
      if (insights.length === 0) return null;
      // Берём инсайт с наибольшим числом затронутых коллег (> 1, чтобы было
      // «ты не один»; одиночное упоминание не сигнал сопричастности).
      let best: BriefInsightCoOccurrence | null = null;
      for (const ins of insights) {
        const colleaguesCount = new Set(ins.personSubjectIds).size;
        if (colleaguesCount < 2) continue;
        const escalated =
          ins.severity === 'high' ||
          ins.severity === 'critical' ||
          ins.dynamicLabel === 'spike';
        if (!best || colleaguesCount > best.colleaguesCount) {
          best = {
            insightId: ins.id,
            statement: (ins.statement ?? '').slice(0, 200),
            colleaguesCount,
            escalated,
          };
        }
      }
      return best;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'personal-daily-brief: insight co-occurrence упал — без сигнала',
      );
      return null;
    }
  }

  // ──────────────────────────── hint (LLM) ────────────────────────────

  private async buildHint(
    tenantId: string,
    input: PersonalBriefHintPromptInput,
  ): Promise<string> {
    try {
      const result = await this.llm.call({
        taskType: PERSONAL_BRIEF_HINT_TASK_TYPE,
        tenantId,
        systemPrompt: PERSONAL_BRIEF_HINT_SYSTEM_PROMPT,
        userMessage: buildPersonalBriefHintUserMessage(input),
        maxTokens: 120,
        sourceRef: { type: 'personal-brief', id: tenantId },
      });
      const text = (result.text ?? '').trim();
      if (text.length > 0) return text.slice(0, 200);
      return buildPersonalBriefFallbackHint(input);
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'personal-daily-brief: LLM подсказка упала — fallback',
      );
      return buildPersonalBriefFallbackHint(input);
    }
  }

  // ──────────────────────────── read (endpoints) ──────────────────────

  /**
   * Прочитать сохранённый бриф пользователя за день (self-scope по personId).
   * Возвращает payload + метаданные. null если за день брифа нет.
   */
  async getForPerson(args: {
    tenantId: string;
    personId: string;
    dateLocal: string;
  }): Promise<{
    id: string;
    dateLocal: string;
    payload: PersonalDailyBriefPayload;
    deliveredAt: string | null;
    openedAt: string | null;
  } | null> {
    const row = await this.prisma.personalDailyBrief.findUnique({
      where: {
        tenantId_personId_dateLocal: {
          tenantId: args.tenantId,
          personId: args.personId,
          dateLocal: args.dateLocal,
        },
      },
      select: {
        id: true,
        dateLocal: true,
        payloadJson: true,
        deliveredAt: true,
        openedAt: true,
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      dateLocal: row.dateLocal,
      payload: parsePayload(row.payloadJson, row.dateLocal),
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    };
  }

  /**
   * Проставить openedAt (идемпотентно — только если ещё null). Проверка владения
   * по personId: чужой бриф открыть нельзя (возвращает false).
   */
  async markOpened(args: {
    tenantId: string;
    personId: string;
    briefId: string;
  }): Promise<boolean> {
    const row = await this.prisma.personalDailyBrief.findUnique({
      where: { id: args.briefId },
      select: { tenantId: true, personId: true, openedAt: true },
    });
    if (!row) return false;
    // Self-scope: бриф должен принадлежать этому Person в этом тенанте.
    if (row.tenantId !== args.tenantId || row.personId !== args.personId) {
      return false;
    }
    if (row.openedAt) return true; // уже открыт — идемпотентно
    await this.prisma.personalDailyBrief.update({
      where: { id: args.briefId },
      data: { openedAt: new Date() },
    });
    this.metrics.incPersonalDailyBriefOpened();
    return true;
  }

  /**
   * Идемпотентный upsert брифа за день (для cron). Перезаписывает payload при
   * повторном прогоне того же дня. `deliveredAt` НЕ трогаем здесь — его ставит
   * cron после успешного push.
   */
  async upsert(args: {
    tenantId: string;
    personId: string;
    dateLocal: string;
    payload: PersonalDailyBriefPayload;
  }): Promise<{ id: string; alreadyDelivered: boolean }> {
    const payloadJson = args.payload as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.personalDailyBrief.upsert({
      where: {
        tenantId_personId_dateLocal: {
          tenantId: args.tenantId,
          personId: args.personId,
          dateLocal: args.dateLocal,
        },
      },
      create: {
        tenantId: args.tenantId,
        personId: args.personId,
        dateLocal: args.dateLocal,
        payloadJson,
      },
      update: {
        payloadJson,
      },
      select: { id: true, deliveredAt: true },
    });
    this.metrics.incPersonalDailyBriefBuilt();
    return { id: row.id, alreadyDelivered: row.deliveredAt !== null };
  }

  /** Пометить, что push доставлен (NULL → now). Идемпотентно. */
  async markDelivered(briefId: string): Promise<void> {
    await this.prisma.personalDailyBrief.update({
      where: { id: briefId },
      data: { deliveredAt: new Date() },
    });
  }

  // ──────────────────────────── helpers ───────────────────────────────

  private isOverdue(due: Date | null | undefined, dayEnd: Date): boolean {
    if (!due) return false;
    // Просрочено, если срок раньше начала текущего дня (т.е. до 00:00 сегодня).
    const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000 + 1);
    return due.getTime() < dayStart.getTime();
  }

  /** Конец локального дня в UTC: dateLocal + 1 день, 00:00 UTC минус 1мс. */
  private endOfDayUtc(dateLocal: string): Date {
    const start = new Date(`${dateLocal}T00:00:00.000Z`);
    return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
}

/** Парсинг payloadJson в типизированный объект (защита от мусора). */
export function parsePayload(
  raw: Prisma.JsonValue,
  dateLocal: string,
): PersonalDailyBriefPayload {
  const empty: PersonalDailyBriefPayload = {
    dateLocal,
    myTasks: [],
    myPromises: [],
    myBlockers: [],
    promisedToMe: [],
    hint: '',
    knowsWho: null,
    counts: { tasks: 0, promises: 0, blockers: 0, promisedToMe: 0 },
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const obj = raw as Record<string, unknown>;
  return {
    dateLocal: typeof obj.dateLocal === 'string' ? obj.dateLocal : dateLocal,
    myTasks: parseItems(obj.myTasks),
    myPromises: parseItems(obj.myPromises),
    myBlockers: parseItems(obj.myBlockers),
    promisedToMe: parseItems(obj.promisedToMe),
    hint: typeof obj.hint === 'string' ? obj.hint : '',
    knowsWho: parseKnowsWho(obj.knowsWho),
    insightCoOccurrence: parseInsightCoOccurrence(obj.insightCoOccurrence),
    counts: parseCounts(obj.counts),
  };
}

function parseInsightCoOccurrence(
  raw: unknown,
): BriefInsightCoOccurrence | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.insightId !== 'string' || typeof o.statement !== 'string') {
    return null;
  }
  return {
    insightId: o.insightId,
    statement: o.statement,
    colleaguesCount:
      typeof o.colleaguesCount === 'number' ? o.colleaguesCount : 0,
    escalated: o.escalated === true,
  };
}

function parseItems(raw: unknown): BriefItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.kind !== 'string' || typeof o.title !== 'string') continue;
    out.push({
      kind: o.kind as BriefItem['kind'],
      dedupKey: typeof o.dedupKey === 'string' ? o.dedupKey : '',
      title: o.title,
      dueDateIso: typeof o.dueDateIso === 'string' ? o.dueDateIso : null,
      overdue: o.overdue === true,
      priority: typeof o.priority === 'number' ? o.priority : undefined,
      counterpartyName:
        typeof o.counterpartyName === 'string' ? o.counterpartyName : null,
    });
  }
  return out;
}

function parseKnowsWho(raw: unknown): BriefKnowsWhoHint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.blockId !== 'string' ||
    typeof o.expertPersonId !== 'string' ||
    typeof o.expertName !== 'string'
  ) {
    return null;
  }
  return {
    blockId: o.blockId,
    blockerText: typeof o.blockerText === 'string' ? o.blockerText : '',
    expertPersonId: o.expertPersonId,
    expertName: o.expertName,
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
  };
}

function parseCounts(raw: unknown): PersonalDailyBriefPayload['counts'] {
  const def = { tasks: 0, promises: 0, blockers: 0, promisedToMe: 0 };
  if (!raw || typeof raw !== 'object') return def;
  const o = raw as Record<string, unknown>;
  return {
    tasks: typeof o.tasks === 'number' ? o.tasks : 0,
    promises: typeof o.promises === 'number' ? o.promises : 0,
    blockers: typeof o.blockers === 'number' ? o.blockers : 0,
    promisedToMe: typeof o.promisedToMe === 'number' ? o.promisedToMe : 0,
  };
}
