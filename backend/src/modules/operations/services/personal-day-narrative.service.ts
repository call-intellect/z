import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  emptyPersonalDayNarrativeDto,
  toPersonalDayNarrativeDto,
  type PersonalDayLetterSectionDto,
  type PersonalDayLoadLevel,
  type PersonalDayNarrativeDto,
  type PersonalDayVerdictDto,
  type PersonDayPackage,
  type PersonDayPackageCommitment,
  type PersonDayPackageTaskRef,
} from '../dto/personal-day-narrative.dto';
import {
  buildPersonDayFallbackMarkdown,
  buildPersonDayUserMessage,
  computePersonalDayMetrics,
  PERSONAL_DAY_JSON_SCHEMA,
  PERSONAL_DAY_NARRATIVE_PROMPT_VERSION,
  PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT,
  PERSONAL_DAY_NARRATIVE_TASK_TYPE,
} from '../prompts/personal-day-narrative.prompt';
import { getLocalDate, localDayWindowUtc } from '../utils/local-date';

export interface PersonDayNarrativeTarget {
  id: string;
  userId: string | null;
  name: string | null;
  timezone: string | null;
}

@Injectable()
export class PersonalDayNarrativeService {
  private readonly logger = new Logger(PersonalDayNarrativeService.name);
  private static readonly MAX = 25;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async getForPerson(args: {
    tenantId: string;
    personId: string;
    dateLocal: string;
  }): Promise<PersonalDayNarrativeDto> {
    const row = await this.prisma.personalDayNarrative.findUnique({
      where: {
        tenantId_personId_dateLocal: {
          tenantId: args.tenantId,
          personId: args.personId,
          dateLocal: args.dateLocal,
        },
      },
    });
    return row ? toPersonalDayNarrativeDto(row) : emptyPersonalDayNarrativeDto(args.dateLocal);
  }

  async markOpened(args: {
    tenantId: string;
    personId: string;
    id: string;
  }): Promise<boolean> {
    const row = await this.prisma.personalDayNarrative.findFirst({
      where: { id: args.id, tenantId: args.tenantId, personId: args.personId },
      select: { id: true, openedAt: true },
    });
    if (!row) return false;
    if (!row.openedAt) {
      await this.prisma.personalDayNarrative.update({
        where: { id: row.id },
        data: { openedAt: new Date() },
      });
    }
    return true;
  }

  async getOrGenerate(args: {
    tenantId: string;
    person: PersonDayNarrativeTarget;
    now: Date;
    packageRef?: Date;
  }): Promise<PersonalDayNarrativeDto> {
    const ref = args.packageRef ?? args.now;
    const dateLocal = getLocalDate(ref, args.person.timezone);
    const existing = await this.prisma.personalDayNarrative.findUnique({
      where: {
        tenantId_personId_dateLocal: {
          tenantId: args.tenantId,
          personId: args.person.id,
          dateLocal,
        },
      },
    });
    if (existing) return toPersonalDayNarrativeDto(existing);
    return this.generate(args);
  }

  async generate(args: {
    tenantId: string;
    person: PersonDayNarrativeTarget;
    now: Date;
    packageRef?: Date;
  }): Promise<PersonalDayNarrativeDto> {
    const { tenantId, person, now } = args;
    const ref = args.packageRef ?? now;
    const dateLocal = getLocalDate(ref, person.timezone);
    const pkg = await this.buildPersonDayPackage({
      tenantId,
      person,
      now,
      packageRef: args.packageRef,
    });
    const metrics = computePersonalDayMetrics(pkg);

    let verdict: PersonalDayVerdictDto | null = null;
    let letter: PersonalDayLetterSectionDto[] = [];
    let bodyMarkdown: string | null;
    let shortSummary: string | null;
    let llmTaskRouteId: string | null = null;

    try {
      const result = await this.llm.call({
        taskType: PERSONAL_DAY_NARRATIVE_TASK_TYPE,
        tenantId,
        systemPrompt: PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT,
        userMessage: buildPersonDayUserMessage(pkg),
        responseFormat: {
          type: 'json_schema',
          name: 'PersonalDay',
          schema: PERSONAL_DAY_JSON_SCHEMA,
          strict: true,
        },
        reasoningEffort: 'medium',
        sourceRef: { type: 'personal-day-narrative', id: `${tenantId}:${person.id}:${dateLocal}` },
      });
      const parsed = parsePersonalDayResponse(result.text);
      if (!parsed) throw new Error('schema_mismatch');
      verdict = parsed.verdict;
      letter = parsed.letter;
      shortSummary = parsed.shortSummary;
      bodyMarkdown = letterToMarkdown(verdict, letter);
      llmTaskRouteId = `${PERSONAL_DAY_NARRATIVE_PROMPT_VERSION}+${result.modelUsed}`;
      this.logger.log(
        {
          tenantId,
          personId: person.id,
          dateLocal,
          model: result.modelUsed,
          inputTokens: result.inputTokens,
          cachedTokens: result.cachedTokens,
          outputTokens: result.outputTokens,
        },
        'personal-day-narrative: письмо сгенерировано',
      );
    } catch (err) {
      const fb = buildPersonDayFallbackMarkdown(pkg);
      bodyMarkdown = fb.bodyMarkdown;
      shortSummary = fb.shortSummary;
      this.logger.warn(
        { tenantId, personId: person.id, dateLocal, err: errMsg(err) },
        'personal-day-narrative: LLM недоступен — сухой fallback',
      );
    }

    const sources = buildSources(pkg);
    const metricsJson = metrics as unknown as Prisma.InputJsonValue;
    const sourcesJson = sources as unknown as Prisma.InputJsonValue;
    const verdictJson = verdict ? (verdict as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
    const letterJson = letter.length
      ? (letter as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;

    const row = await this.prisma.personalDayNarrative.upsert({
      where: {
        tenantId_personId_dateLocal: { tenantId, personId: person.id, dateLocal },
      },
      create: {
        tenantId,
        personId: person.id,
        dateLocal,
        bodyMarkdown,
        shortSummary,
        metricsJson,
        sourcesJson,
        verdictJson,
        letterJson,
        llmTaskRouteId,
      },
      update: {
        bodyMarkdown,
        shortSummary,
        metricsJson,
        sourcesJson,
        verdictJson,
        letterJson,
        llmTaskRouteId,
      },
    });
    return toPersonalDayNarrativeDto(row);
  }

  async buildPersonDayPackage(args: {
    tenantId: string;
    person: PersonDayNarrativeTarget;
    now: Date;
    packageRef?: Date;
  }): Promise<PersonDayPackage> {
    const { tenantId, person, now } = args;
    const ref = args.packageRef ?? now;
    const dateLocal = getLocalDate(ref, person.timezone);
    const { from: dayStart, to: dayEnd } = localDayWindowUtc(ref, person.timezone);
    const userId = person.userId;

    const [
      doneToday,
      openTasks,
      commitments,
      meetings,
      checkins,
      voiceRows,
      blockerRows,
      activeTasks,
      goal,
    ] = await Promise.all([
      userId ? this.collectDoneToday(tenantId, userId, dayStart, dayEnd) : Promise.resolve([]),
      userId ? this.collectOpenTasks(tenantId, userId) : Promise.resolve([]),
      this.collectCommitments(tenantId, person.id, dayStart, dayEnd, now),
      this.collectMeetings(tenantId, person.id, dayStart, dayEnd),
      this.collectCheckins(tenantId, person.id, dateLocal),
      this.collectVoice(tenantId, person.id, dayStart, dayEnd),
      this.collectBlockers(tenantId, person.id),
      userId ? this.countActiveTasks(tenantId, userId) : Promise.resolve(0),
      this.collectContribution(tenantId, person.id, now),
    ]);

    const staleDays = await this.cfg.getDynamic<number>(
      'dashboard.stuck.staleDaysThreshold',
      undefined,
      5,
    );
    const cutoff = new Date(now.getTime() - staleDays * 86_400_000);
    const overloadThreshold = await this.cfg.getDynamic<number>(
      'dashboard.load.overload_threshold',
      undefined,
      8,
    );
    const idleThreshold = await this.cfg.getDynamic<number>(
      'dashboard.load.idle_threshold',
      undefined,
      2,
    );

    const tasksOverdue: PersonDayPackageTaskRef[] = [];
    const tasksStuck: PersonDayPackageTaskRef[] = [];
    for (const t of openTasks) {
      if (t.dueDate && t.dueDate < now) {
        tasksOverdue.push({ id: t.id, title: t.title, hint: dueHint(t.dueDate) });
      } else if (t.lastActivityAt < cutoff) {
        tasksStuck.push({ id: t.id, title: t.title, hint: 'без движения' });
      }
    }

    const loadLevel: PersonalDayLoadLevel | null =
      activeTasks > overloadThreshold ? 'overloaded' : activeTasks <= idleThreshold ? 'idle' : 'normal';

    return {
      personName: person.name,
      dateLocal,
      tasksDoneToday: doneToday,
      tasksOverdue,
      tasksStuck,
      planText: checkins.planText,
      factText: checkins.factText,
      notDone: checkins.notDone,
      commitmentsGiven: commitments.given,
      commitmentsOverdue: commitments.overdue,
      activeTasks,
      loadLevel,
      goalNetScore: goal.netScore,
      weekStart: goal.weekStart,
      goalName: goal.goalName,
      meetings,
      voice: voiceRows,
      blockers: blockerRows,
    };
  }

  private async collectDoneToday(
    tenantId: string,
    userId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<PersonDayPackageTaskRef[]> {
    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId,
        deletedAt: null,
        assignees: { some: { userId } },
        completedAt: { gte: dayStart, lt: dayEnd },
      },
      select: { id: true, title: true, identifier: true },
      take: PersonalDayNarrativeService.MAX,
      orderBy: { completedAt: 'desc' },
    });
    return rows.map((r) => ({ id: r.id, title: `${r.identifier}: ${r.title}`.slice(0, 200), hint: null }));
  }

  private async collectOpenTasks(
    tenantId: string,
    userId: string,
  ): Promise<Array<{ id: string; title: string; dueDate: Date | null; lastActivityAt: Date }>> {
    const rows = await this.prisma.issue.findMany({
      where: {
        tenantId,
        deletedAt: null,
        archivedAt: null,
        assignees: { some: { userId } },
        OR: [{ state: null }, { state: { category: { notIn: ['completed', 'cancelled'] } } }],
      },
      select: { id: true, title: true, identifier: true, dueDate: true, createdAt: true },
      take: 300,
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const activity = await this.prisma.issueActivity.groupBy({
      by: ['issueId'],
      where: { issueId: { in: ids } },
      _max: { createdAt: true },
    });
    const lastById = new Map<string, Date>();
    for (const a of activity) {
      if (a._max.createdAt) lastById.set(a.issueId, a._max.createdAt);
    }
    return rows.map((r) => ({
      id: r.id,
      title: `${r.identifier}: ${r.title}`.slice(0, 200),
      dueDate: r.dueDate,
      lastActivityAt: lastById.get(r.id) ?? r.createdAt,
    }));
  }

  private async countActiveTasks(tenantId: string, userId: string): Promise<number> {
    return this.prisma.issueAssignee.count({
      where: { userId, issue: { tenantId, completedAt: null, deletedAt: null } },
    });
  }

  private async collectCommitments(
    tenantId: string,
    personId: string,
    dayStart: Date,
    dayEnd: Date,
    now: Date,
  ): Promise<{ given: PersonDayPackageCommitment[]; overdue: PersonDayPackageCommitment[] }> {
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'commitment',
        commitmentAuthorPersonId: personId,
        status: { not: 'archived' },
        supersededById: null,
        mergedIntoId: null,
      },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        criticalQuestion: true,
        commitmentDueDate: true,
        commitmentRecipientPersonId: true,
        createdAt: true,
      },
      take: PersonalDayNarrativeService.MAX,
      orderBy: { commitmentDueDate: 'asc' },
    });
    const recipientIds = [
      ...new Set(rows.map((r) => r.commitmentRecipientPersonId).filter((v): v is string => !!v)),
    ];
    const nameById = new Map<string, string>();
    if (recipientIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId, id: { in: recipientIds } },
        select: { id: true, name: true },
      });
      for (const p of persons) nameById.set(p.id, p.name);
    }
    const toItem = (r: (typeof rows)[number]): PersonDayPackageCommitment => ({
      id: r.id,
      text: (r.trustedAnswer?.trim() || r.name || r.criticalQuestion || 'Обещание').slice(0, 200),
      counterpartName: r.commitmentRecipientPersonId
        ? (nameById.get(r.commitmentRecipientPersonId) ?? null)
        : null,
      dueLabel: r.commitmentDueDate ? dateLabel(r.commitmentDueDate) : null,
    });
    const given: PersonDayPackageCommitment[] = [];
    const overdue: PersonDayPackageCommitment[] = [];
    for (const r of rows) {
      if (r.commitmentDueDate && r.commitmentDueDate < now) overdue.push(toItem(r));
      else if (r.createdAt >= dayStart && r.createdAt < dayEnd) given.push(toItem(r));
    }
    return { given, overdue };
  }

  private async collectMeetings(
    tenantId: string,
    personId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<PersonDayPackage['meetings']> {
    const rows = await this.prisma.meeting.findMany({
      where: {
        tenantId,
        deletedAt: null,
        endedAt: { gte: dayStart, lt: dayEnd },
        participants: { some: { personId } },
      },
      select: {
        id: true,
        title: true,
        endedAt: true,
        aiResult: { select: { summaryFast: true } },
      },
      take: 20,
      orderBy: { endedAt: 'asc' },
    });
    return rows
      .filter((m) => m.aiResult?.summaryFast)
      .map((m) => ({
        id: m.id,
        title: m.title.slice(0, 120),
        summary: (m.aiResult?.summaryFast ?? '').slice(0, 600),
        ref: m.endedAt ? dateLabel(m.endedAt) : 'встреча',
      }));
  }

  private async collectCheckins(
    tenantId: string,
    personId: string,
    dateLocal: string,
  ): Promise<{ planText: string | null; factText: string | null; notDone: string[] }> {
    const rows = await this.prisma.dailyCheckIn.findMany({
      where: { tenantId, personId, dateLocal, kind: { in: ['morning', 'evening'] } },
      select: {
        kind: true,
        plansJson: true,
        donesJson: true,
        notDoneJson: true,
        rawResponseText: true,
      },
    });
    let planText: string | null = null;
    let factText: string | null = null;
    let notDone: string[] = [];
    for (const r of rows) {
      if (r.kind === 'morning') {
        planText = jsonListToText(r.plansJson) || (r.rawResponseText?.trim() ?? null);
      } else if (r.kind === 'evening') {
        factText = jsonListToText(r.donesJson) || (r.rawResponseText?.trim() ?? null);
        notDone = jsonListToArray(r.notDoneJson);
      }
    }
    return { planText, factText, notDone };
  }

  private async collectVoice(
    tenantId: string,
    personId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<PersonDayPackage['voice']> {
    const rows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        tenantId,
        authorPersonId: personId,
        sourceTimestamp: { gte: dayStart, lt: dayEnd },
      },
      select: {
        sourceTimestamp: true,
        block: { select: { signalType: true, name: true, trustedAnswer: true } },
      },
      take: 200,
    });
    const seen = new Set<string>();
    const out: PersonDayPackage['voice'] = [];
    for (const r of rows) {
      if (!r.block) continue;
      const text = (r.block.trustedAnswer?.trim() || r.block.name).slice(0, 300);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push({
        label: signalLabel(r.block.signalType),
        ref: r.sourceTimestamp ? dateLabel(r.sourceTimestamp) : 'граф',
        excerpt: text,
      });
      if (out.length >= 12) break;
    }
    return out;
  }

  private async collectBlockers(
    tenantId: string,
    personId: string,
  ): Promise<PersonDayPackage['blockers']> {
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: { in: ['blocker', 'knowledge_gap'] },
        commitmentAuthorPersonId: personId,
        status: { not: 'archived' },
        supersededById: null,
        mergedIntoId: null,
      },
      select: { id: true, name: true, criticalQuestion: true },
      take: PersonalDayNarrativeService.MAX,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => ({
      id: b.id,
      text: (b.name || b.criticalQuestion || 'Блокер').slice(0, 200),
    }));
  }

  private async collectContribution(
    tenantId: string,
    personId: string,
    now: Date,
  ): Promise<{ netScore: number | null; weekStart: string | null; goalName: string | null }> {
    const primaryGoal =
      (await this.prisma.goal.findFirst({
        where: { tenantId, isPrimary: true },
        select: { id: true, name: true },
      })) ??
      (await this.prisma.goal.findFirst({
        where: { tenantId, status: 'active' },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, name: true },
      }));
    if (!primaryGoal) return { netScore: null, weekStart: null, goalName: null };

    const monday = mondayUtc(now);
    const contributions = await this.prisma.personGoalContribution.findMany({
      where: {
        tenantId,
        goalId: primaryGoal.id,
        personId,
        weekStart: { gte: monday },
      },
      select: { netScore: true },
    });
    if (contributions.length === 0) {
      return { netScore: null, weekStart: isoDate(monday), goalName: primaryGoal.name };
    }
    const net = contributions.reduce((sum, c) => sum + Number(c.netScore), 0);
    return { netScore: net, weekStart: isoDate(monday), goalName: primaryGoal.name };
  }
}

function parsePersonalDayResponse(raw: string): {
  verdict: PersonalDayVerdictDto;
  letter: PersonalDayLetterSectionDto[];
  shortSummary: string;
} | null {
  const text = stripJsonFence(raw ?? '');
  try {
    const obj = JSON.parse(text) as {
      verdict?: PersonalDayVerdictDto;
      letter?: PersonalDayLetterSectionDto[];
      shortSummary?: string;
    };
    if (!obj || typeof obj !== 'object') return null;
    if (!obj.verdict || !Array.isArray(obj.letter) || typeof obj.shortSummary !== 'string') {
      return null;
    }
    return { verdict: obj.verdict, letter: obj.letter, shortSummary: obj.shortSummary };
  } catch {
    return null;
  }
}

function stripJsonFence(raw: string): string {
  const t = raw.trim();
  if (t.startsWith('```')) {
    return t
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
  }
  return t;
}

function letterToMarkdown(
  verdict: PersonalDayVerdictDto,
  letter: PersonalDayLetterSectionDto[],
): string {
  const lines: string[] = [];
  lines.push(`# ${verdict.overall.emoji} ${verdict.overall.title}`);
  lines.push('');
  lines.push(verdict.overall.oneLiner);
  for (const s of letter) {
    lines.push('', `## ${s.title}`, s.prose);
  }
  return lines.join('\n');
}

function buildSources(pkg: PersonDayPackage): Record<string, string[]> {
  return {
    meetings: pkg.meetings.map((m) => m.id),
    tasks: [...pkg.tasksDoneToday, ...pkg.tasksOverdue, ...pkg.tasksStuck].map((t) => t.id),
    commitments: [...pkg.commitmentsGiven, ...pkg.commitmentsOverdue].map((c) => c.id),
    blockers: pkg.blockers.map((b) => b.id),
  };
}

function jsonListToArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : typeof v === 'object' && v && 'text' in v ? String((v as { text: unknown }).text) : ''))
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 10);
  }
  return [];
}

function jsonListToText(value: unknown): string | null {
  const arr = jsonListToArray(value);
  return arr.length > 0 ? arr.join('; ') : null;
}

function signalLabel(signalType: string): string {
  if (signalType === 'idea') return 'идея';
  if (signalType === 'decision') return 'решение';
  if (signalType === 'risk') return 'риск';
  return 'высказывание';
}

function dueHint(due: Date): string {
  return `срок ${dateLabel(due)}`;
}

function dateLabel(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayUtc(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
