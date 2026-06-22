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

    const myTasksRaw = userId
      ? await this.collectMyTasks({
          tenantId: args.tenantId,
          userId,
          dayEnd,
        })
      : [];

    const myPromisesRaw = await this.collectMyPromises({
      tenantId: args.tenantId,
      personId: args.personId,
      dayEnd,
    });

    const myBlockersRaw = await this.collectMyBlockers({
      tenantId: args.tenantId,
      personId: args.personId,
    });

    const promisedToMeRaw = await this.collectPromisedToMe({
      tenantId: args.tenantId,
      personId: args.personId,
    });

    const myTasks = dedupBriefItems(myTasksRaw).slice(0, PersonalDailyBriefService.MAX_ITEMS);
    const myPromisesDeduped = dedupBriefItems(myPromisesRaw);
    const myPromises = dropPromisesThatBecameTasks({
      tasks: myTasks,
      promises: myPromisesDeduped,
    }).slice(0, PersonalDailyBriefService.MAX_ITEMS);
    const myBlockers = dedupBriefItems(myBlockersRaw).slice(0, PersonalDailyBriefService.MAX_ITEMS);
    const promisedToMe = dedupBriefItems(promisedToMeRaw).slice(
      0,
      PersonalDailyBriefService.MAX_ITEMS,
    );

    const knowsWho = await this.resolveKnowsWhoHint({
      tenantId: args.tenantId,
      selfPersonId: args.personId,
      blockers: myBlockers,
    });

    const insightCoOccurrence = await this.resolveInsightCoOccurrence({
      tenantId: args.tenantId,
      personId: args.personId,
      personEntityId: person?.entityId ?? null,
    });

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

  hasContent(payload: PersonalDailyBriefPayload): boolean {
    return (
      payload.counts.tasks > 0 ||
      payload.counts.promises > 0 ||
      payload.counts.blockers > 0 ||
      payload.counts.promisedToMe > 0
    );
  }

  private async collectMyTasks(args: {
    tenantId: string;
    userId: string;
    dayEnd: Date;
  }): Promise<BriefItem[]> {
    const out: BriefItem[] = [];

    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        archivedAt: null,
        assignees: { some: { userId: args.userId } },
        AND: [
          { OR: [{ dueDate: { lte: args.dayEnd } }, { dueDate: null }] },
          { OR: [{ state: null }, { state: { category: { notIn: ['completed', 'cancelled'] } } }] },
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
        priority: 10,
      });
    }

    const tasks = await this.prisma.task.findMany({
      where: {
        tenantId: args.tenantId,
        assigneeUserId: args.userId,
        status: { not: 'done' },
        OR: [{ dueDate: { lte: args.dayEnd } }, { dueDate: null }],
      },
      select: { id: true, title: true, dueDate: true, evidenceBlockIds: true },
      orderBy: [{ dueDate: 'asc' }],
      take: PersonalDailyBriefService.MAX_ITEMS,
    });
    for (const t of tasks) {
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
      let best: BriefInsightCoOccurrence | null = null;
      for (const ins of insights) {
        const colleaguesCount = new Set(ins.personSubjectIds).size;
        if (colleaguesCount < 2) continue;
        const escalated =
          ins.severity === 'high' || ins.severity === 'critical' || ins.dynamicLabel === 'spike';
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

  private async buildHint(tenantId: string, input: PersonalBriefHintPromptInput): Promise<string> {
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

  async getForPerson(args: { tenantId: string; personId: string; dateLocal: string }): Promise<{
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
    if (row.tenantId !== args.tenantId || row.personId !== args.personId) {
      return false;
    }
    if (row.openedAt) return true;
    await this.prisma.personalDailyBrief.update({
      where: { id: args.briefId },
      data: { openedAt: new Date() },
    });
    this.metrics.incPersonalDailyBriefOpened();
    return true;
  }

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

  async markDelivered(briefId: string): Promise<void> {
    await this.prisma.personalDailyBrief.update({
      where: { id: briefId },
      data: { deliveredAt: new Date() },
    });
  }

  private isOverdue(due: Date | null | undefined, dayEnd: Date): boolean {
    if (!due) return false;
    const dayStart = new Date(dayEnd.getTime() - 24 * 60 * 60 * 1000 + 1);
    return due.getTime() < dayStart.getTime();
  }

  private endOfDayUtc(dateLocal: string): Date {
    const start = new Date(`${dateLocal}T00:00:00.000Z`);
    return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
}

export function parsePayload(raw: Prisma.JsonValue, dateLocal: string): PersonalDailyBriefPayload {
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

function parseInsightCoOccurrence(raw: unknown): BriefInsightCoOccurrence | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.insightId !== 'string' || typeof o.statement !== 'string') {
    return null;
  }
  return {
    insightId: o.insightId,
    statement: o.statement,
    colleaguesCount: typeof o.colleaguesCount === 'number' ? o.colleaguesCount : 0,
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
      counterpartyName: typeof o.counterpartyName === 'string' ? o.counterpartyName : null,
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
