import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { PendingActionsService } from '../../pending-actions/services/pending-actions.service';
import {
  mapAvailablePeriod,
  type AvailablePeriodsDto,
} from '../dto/available-periods.dto';
import type {
  DailyDigestMetricsDto,
  DailyDigestSourcesDto,
  DailyDigestAggregates,
  DailyOperationsDigestDto,
  DailyDigestEventDto,
  DailyDigestUrgentItemDto,
  DailyDigestPersonShinedDto,
  DailyDigestPersonStruggledDto,
  DailyDigestCustomerAtRiskDto,
  DailyDigestChronicBlockerDto,
  DailyDigestTrendPointDto,
  DailyDigestVerdictDto,
  DailyDigestLetterSectionDto,
  DailyDigestGoalAlignmentDayDto,
} from '../dto/daily-digest.dto';
import {
  DAILY_DIGEST_TASK_TYPE,
  DAY_COMPANY_JSON_SCHEMA,
  DAY_COMPANY_PROMPT_VERSION,
  DAY_COMPANY_SYSTEM_PROMPT,
  DayCompanyResponseSchema,
  buildDayCompanyUserMessage,
  buildFallbackDigestMarkdown,
  dayCompanyToBodyMarkdown,
  type DayCompanyPackage,
  type DayCompanyResponse,
} from '../prompts/daily-digest.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import { BlockerSynthesisService } from './blocker-synthesis.service';
import { CustomerRiskRadarService } from './customer-risk-radar.service';

export interface DayVerdictSignals {
  hasNegativeClientSignal: boolean;
  executionStrained: boolean;
}

export function mapDailyDigestRowsToTrend(
  rowsDesc: Array<{ dateLocal: string; metricsJson: unknown }>,
): DailyDigestTrendPointDto[] {
  return rowsDesc
    .map((r) => {
      const m = (r.metricsJson ?? {}) as Record<string, unknown>;
      const goals = (m.goals ?? {}) as Record<string, unknown>;
      return {
        dateLocal: r.dateLocal,
        totalCheckIns: Number(m.totalCheckIns ?? 0),
        greenShare: Number(m.greenShare ?? 0),
        redShare: Number(m.redShare ?? 0),
        blockers: Array.isArray(m.newBlockers) ? m.newBlockers.length : 0,
        overdueCommitments: Array.isArray(m.overdueCommitments) ? m.overdueCommitments.length : 0,
        goalsCompleted: Number(goals.completed ?? 0),
        goalsFailed: Number(goals.failed ?? 0),
      };
    })
    .reverse();
}

export function computeVerdictSignals(
  metrics: DailyDigestMetricsDto,
  pkg: DayCompanyPackage,
  staleDaysThreshold: number,
): DayVerdictSignals {
  const criticalCustomer = pkg.customersAtRisk.some((c) => c.riskLevel === 'critical');
  const severeInsight = pkg.topInsights.some(
    (i) => i.severity === 'high' || i.severity === 'critical',
  );
  const hasNegativeClientSignal = criticalCustomer || severeInsight;

  const strongBlocker = metrics.newBlockers.some((b) => b.confidence >= 0.8);
  const overdueAged = countOverdueAged(metrics.overdueCommitments, staleDaysThreshold) >= 1;
  const executionStrained = strongBlocker || overdueAged;

  return { hasNegativeClientSignal, executionStrained };
}

function countOverdueAged(
  overdue: DailyDigestMetricsDto['overdueCommitments'],
  staleDaysThreshold: number,
): number {
  const now = Date.now();
  let count = 0;
  for (const c of overdue) {
    if (!c.dueDate) {
      count += 1;
      continue;
    }
    const due = new Date(`${c.dueDate}T00:00:00.000Z`).getTime();
    if (Number.isNaN(due)) {
      count += 1;
      continue;
    }
    const ageDays = (now - due) / (24 * 60 * 60 * 1000);
    if (ageDays >= staleDaysThreshold) count += 1;
  }
  return count;
}

export function clampVerdict(
  verdict: DailyDigestVerdictDto,
  signals: DayVerdictSignals,
): DailyDigestVerdictDto {
  const axes = verdict.axes.map((a) => ({ ...a }));
  const overall = { ...verdict.overall };

  const clientsAxis = axes.find((a) => a.key === 'clients');
  if (signals.hasNegativeClientSignal && clientsAxis && clientsAxis.state === 'ok') {
    clientsAxis.state = 'risk';
  }

  const executionAxis = axes.find((a) => a.key === 'execution');
  if (signals.executionStrained && executionAxis && executionAxis.state === 'ok') {
    executionAxis.state = 'warn';
  }

  const anyDomainRisk = axes.some(
    (a) => (a.key === 'team' || a.key === 'clients' || a.key === 'execution') && a.state === 'risk',
  );
  if (anyDomainRisk) {
    if (overall.state === 'ok') overall.state = 'warn';
    const overallAxis = axes.find((a) => a.key === 'overall');
    if (overallAxis && overallAxis.state === 'ok') overallAxis.state = 'warn';
  }

  return { overall, axes };
}

export function previousDateLocal(dateLocal: string): string {
  const [y, m, d] = dateLocal.split('-').map(Number);
  if (!y || !m || !d) return dateLocal;
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

function unwrapEnvelopes(value: unknown): unknown[] {
  const out: unknown[] = [value];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of ['result', 'data', 'output', 'response']) {
      if (obj[key] && typeof obj[key] === 'object') out.push(obj[key]);
    }
  }
  return out;
}

export function extractDayCompanyResponse(result: {
  text: string;
  toolCalls?: Array<{ input: unknown }>;
}): DayCompanyResponse | null {
  const roots: unknown[] = [];
  const firstTool = result.toolCalls?.[0];
  if (firstTool) roots.push(firstTool.input);
  roots.push(tryParseJson(result.text ?? ''));
  for (const root of roots) {
    for (const candidate of unwrapEnvelopes(root)) {
      const parsed = DayCompanyResponseSchema.safeParse(candidate);
      if (parsed.success) return parsed.data;
    }
  }
  return null;
}

@Injectable()
export class DailyDigestService {
  private readonly logger = new Logger(DailyDigestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(PendingActionsService)
    private readonly pendingActions: PendingActionsService,
    @Inject(CustomerRiskRadarService)
    private readonly customerRisk: CustomerRiskRadarService,
    @Inject(BlockerSynthesisService)
    private readonly blockerSynthesis: BlockerSynthesisService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
  ) {}

  async getStored(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DailyOperationsDigestDto | null> {
    const row = await this.prisma.dailyOperationsDigest.findUnique({
      where: {
        tenantId_dateLocal: {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
        },
      },
    });
    if (!row) return null;
    return this.enrichDto(this.toDto(row));
  }

  async getLatest(args: { tenantId: string }): Promise<DailyOperationsDigestDto | null> {
    const row = await this.prisma.dailyOperationsDigest.findFirst({
      where: { tenantId: args.tenantId },
      orderBy: { dateLocal: 'desc' },
    });
    if (!row) return null;
    return this.enrichDto(this.toDto(row));
  }

  async getOrGenerate(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DailyOperationsDigestDto> {
    const existing = await this.getStored(args);
    if (existing) return existing;
    return this.generate(args);
  }

  async listAvailablePeriods(args: {
    tenantId: string;
    limit: number;
  }): Promise<AvailablePeriodsDto> {
    const rows = await this.prisma.dailyOperationsDigest.findMany({
      where: { tenantId: args.tenantId },
      orderBy: { dateLocal: 'desc' },
      take: args.limit,
      select: { dateLocal: true, verdictJson: true },
    });
    const periods = rows.map((r) => mapAvailablePeriod(r.dateLocal, r.verdictJson));
    return { rhythm: 'day', periods, latest: periods[0]?.period ?? null };
  }

  async generate(args: { tenantId: string; dateLocal: string }): Promise<DailyOperationsDigestDto> {
    const tenantTop = resolveOperationsTenantTop(args.tenantId);
    let aggregates: { metrics: DailyDigestMetricsDto; sources: DailyDigestSourcesDto };
    try {
      aggregates = await this.aggregate({
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
      });
    } catch (err) {
      this.metrics.incCooDailyDigestFailed({
        tenantTop,
        reason: 'aggregation_failed',
      });
      this.logger.error(
        {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: ошибка агрегации источников',
      );
      throw err;
    }

    const promptInput: DailyDigestAggregates = {
      dateLocal: args.dateLocal,
      totalCheckIns: aggregates.metrics.totalCheckIns,
      greenShare: aggregates.metrics.greenShare,
      yellowShare: aggregates.metrics.yellowShare,
      redShare: aggregates.metrics.redShare,
      topRedCheckIns: aggregates.metrics.topRedCheckIns.map((r) => ({
        personName: r.personName,
        excerpt: r.excerpt,
      })),
      newBlockers: aggregates.metrics.newBlockers.map((b) => ({
        name: b.name,
        confidence: b.confidence,
      })),
      overdueCommitments: aggregates.metrics.overdueCommitments.map((c) => ({
        name: c.name,
        dueDate: c.dueDate,
      })),
      goals: {
        completed: aggregates.metrics.goals.completed,
        failed: aggregates.metrics.goals.failed,
        activated: aggregates.metrics.goals.activated,
      },
      newHighInsights: aggregates.metrics.newHighInsights.map((i) => ({
        statement: i.statement,
        kind: i.kind,
        causeCategory: i.causeCategory,
      })),
    };

    const pkg = await this.buildDayPackage({
      tenantId: args.tenantId,
      dateLocal: args.dateLocal,
    });
    const staleDays = await this.cfg.getDynamic<number>(
      'dashboard.stuck.staleDaysThreshold',
      'DASHBOARD_STUCK_STALE_DAYS',
      5,
    );
    const signals = computeVerdictSignals(aggregates.metrics, pkg, staleDays);

    let bodyMarkdown: string;
    let shortSummary: string | null;
    let llmTaskRouteId: string | null;
    let verdictObj: DailyDigestVerdictDto | null;
    let letterArr: DailyDigestLetterSectionDto[] | null;
    let goalDayObj: DailyDigestGoalAlignmentDayDto | null;
    let risksSummary: string | null;
    let ideasSummary: string | null;
    try {
      const result = await this.llm.call({
        taskType: DAILY_DIGEST_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: DAY_COMPANY_SYSTEM_PROMPT,
        userMessage: buildDayCompanyUserMessage(pkg, aggregates.metrics, args.dateLocal),
        responseFormat: {
          type: 'json_schema',
          name: 'DayCompany',
          schema: DAY_COMPANY_JSON_SCHEMA,
          strict: true,
        },
        reasoningEffort: 'high',
        maxTokens: 8_000,
        sourceRef: { type: 'daily-digest', id: `${args.tenantId}:${args.dateLocal}` },
      });
      const validatedData = extractDayCompanyResponse(result);
      if (!validatedData) throw new Error('schema_mismatch');
      const verdict = clampVerdict(validatedData.verdict, signals);
      const goalAlignmentDay: DailyDigestGoalAlignmentDayDto = {
        ...validatedData.goalAlignmentDay,
        goalId: pkg.goalId ?? null,
        goalName: pkg.goalName ?? null,
      };
      verdictObj = verdict;
      letterArr = validatedData.letter;
      goalDayObj = goalAlignmentDay;
      risksSummary = validatedData.risksSummary;
      ideasSummary = validatedData.ideasSummary;
      bodyMarkdown = dayCompanyToBodyMarkdown(verdict, validatedData.letter);
      shortSummary = verdict.overall.oneLiner;
      llmTaskRouteId = `${DAY_COMPANY_PROMPT_VERSION}+${result.modelUsed}`;
    } catch (err) {
      this.metrics.incCooDailyDigestFailed({
        tenantTop,
        reason: 'llm_failed',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: LLM упал — сохраняю «сухой» вариант',
      );
      const fallback = buildFallbackDigestMarkdown(promptInput);
      bodyMarkdown = fallback.bodyMarkdown;
      shortSummary = fallback.shortSummary;
      verdictObj = null;
      letterArr = null;
      goalDayObj = null;
      risksSummary = null;
      ideasSummary = null;
      llmTaskRouteId = null;
    }

    const metricsToStore = { ...aggregates.metrics, risksSummary, ideasSummary };

    const row = await this.prisma.dailyOperationsDigest.upsert({
      where: {
        tenantId_dateLocal: {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
        },
      },
      create: {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
        bodyMarkdown,
        shortSummary,
        metricsJson: metricsToStore as unknown as Prisma.InputJsonValue,
        sourcesJson: aggregates.sources as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
        verdictJson: verdictObj
          ? (verdictObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        letterJson: letterArr ? (letterArr as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        goalAlignmentDayJson: goalDayObj
          ? (goalDayObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
      update: {
        bodyMarkdown,
        shortSummary,
        metricsJson: metricsToStore as unknown as Prisma.InputJsonValue,
        sourcesJson: aggregates.sources as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
        verdictJson: verdictObj
          ? (verdictObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        letterJson: letterArr ? (letterArr as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        goalAlignmentDayJson: goalDayObj
          ? (goalDayObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    this.metrics.incCooDailyDigestGenerated({ tenantTop });
    this.metrics.setCooDailyDigestAge({
      tenantTop,
      value: Math.max(0, (Date.now() - row.createdAt.getTime()) / 1000),
    });
    return this.enrichDto(this.toDto(row));
  }

  async markDelivered(args: { tenantId: string; dateLocal: string }): Promise<void> {
    await this.prisma.dailyOperationsDigest.updateMany({
      where: {
        tenantId: args.tenantId,
        dateLocal: args.dateLocal,
      },
      data: { deliveredAt: new Date() },
    });
  }

  async buildPendingActionsLine(args: {
    tenantId: string;
    userId: string;
  }): Promise<string | null> {
    try {
      const count = await this.pendingActions.getCount({
        tenantId: args.tenantId,
        userId: args.userId,
      });
      if (count.total === 0) return null;
      return `\n\n🔔 Ждёт вашего подтверждения: ${count.total}. Открыть: /actions`;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          userId: args.userId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: блок «Ждёт подтверждения» упал — пропускаю',
      );
      return null;
    }
  }

  async buildCustomersAtRiskLine(args: { tenantId: string }): Promise<string | null> {
    try {
      const top = await this.customerRisk.topForDigest({
        tenantId: args.tenantId,
        limit: 3,
      });
      if (top.length === 0) return null;
      const lines = top.map(
        (c) =>
          `• ${c.customerName.slice(0, 60)} — ${
            c.riskLevel === 'critical' ? 'критический' : 'повышенный'
          }`,
      );
      return `\n\n⚠️ Клиенты под риском:\n${lines.join('\n')}`;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: строка «Клиенты под риском» упала — пропускаю',
      );
      return null;
    }
  }

  async aggregate(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<{ metrics: DailyDigestMetricsDto; sources: DailyDigestSourcesDto }> {
    const dayStart = parseDateLocalToUtc(args.dateLocal);
    const dayEnd = endOfDayUtc(dayStart);

    const [checkIns, redCheckIns, newBlockers, overdueCommitments, goalsChanged, highInsights] =
      await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: { in: ['green', 'yellow', 'red'] },
          dateLocal: args.dateLocal,
        },
        select: { sentiment: true, id: true },
      }),
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: 'red',
          dateLocal: args.dateLocal,
        },
        select: {
          id: true,
          rawResponseText: true,
          person: { select: { name: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: 3,
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'blocker',
          createdAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          name: true,
          confidence: true,
        },
        orderBy: [{ confidence: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: { in: ['open', 'asked'] },
          commitmentDueDate: { lte: dayEnd },
        },
        select: {
          id: true,
          name: true,
          commitmentDueDate: true,
          commitmentRecipientPersonId: true,
        },
        orderBy: { commitmentDueDate: 'asc' },
        take: 5,
      }),
      this.prisma.goal.findMany({
        where: {
          tenantId: args.tenantId,
          updatedAt: { gte: dayStart, lte: dayEnd },
        },
        select: { id: true, status: true, archivedAt: true },
      }),
      this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          severity: 'high',
          firstObservedAt: { gte: dayStart, lte: dayEnd },
        },
        select: {
          id: true,
          statement: true,
          kind: true,
          causeCategory: true,
        },
        orderBy: { firstObservedAt: 'desc' },
        take: 5,
      }),
    ]);

    let g = 0;
    let y = 0;
    let r = 0;
    for (const row of checkIns) {
      if (row.sentiment === 'green') g++;
      else if (row.sentiment === 'yellow') y++;
      else if (row.sentiment === 'red') r++;
    }
    const total = g + y + r;

    const completedGoals = goalsChanged.filter((g0) => g0.status === 'achieved');
    const failedGoals = goalsChanged.filter((g0) => g0.status === 'abandoned');
    const activatedGoals = goalsChanged.filter(
      (g0) => g0.status === 'active' && g0.archivedAt === null,
    );

    const metrics: DailyDigestMetricsDto = {
      totalCheckIns: total,
      greenShare: total > 0 ? g / total : 0,
      yellowShare: total > 0 ? y / total : 0,
      redShare: total > 0 ? r / total : 0,
      topRedCheckIns: redCheckIns.map((c) => ({
        checkInId: c.id,
        personName: c.person?.name ?? null,
        excerpt: (c.rawResponseText ?? '').slice(0, 200),
      })),
      newBlockers: newBlockers.map((b) => ({
        blockId: b.id,
        name: (b.name ?? '').slice(0, 400),
        confidence: Number(b.confidence),
      })),
      overdueCommitments: overdueCommitments.map((c) => ({
        blockId: c.id,
        name: (c.name ?? '').slice(0, 400),
        dueDate: c.commitmentDueDate ? c.commitmentDueDate.toISOString().slice(0, 10) : null,
        recipientPersonId: c.commitmentRecipientPersonId,
      })),
      goals: {
        completed: completedGoals.length,
        failed: failedGoals.length,
        activated: activatedGoals.length,
        completedIds: completedGoals.map((g0) => g0.id),
        failedIds: failedGoals.map((g0) => g0.id),
      },
      newHighInsights: highInsights.map((i) => ({
        insightId: i.id,
        statement: (i.statement ?? '').slice(0, 400),
        kind: i.kind,
        causeCategory: i.causeCategory,
      })),
    };

    const sources: DailyDigestSourcesDto = {
      checkInIds: checkIns.map((c) => c.id),
      blockerIds: newBlockers.map((b) => b.id),
      commitmentIds: overdueCommitments.map((c) => c.id),
      goalIds: goalsChanged.map((g0) => g0.id),
      insightIds: highInsights.map((i) => i.id),
    };

    return { metrics, sources };
  }

  private async buildDayPackage(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DayCompanyPackage> {
    const [dayStart, dayEnd] = this.parseDayBoundsMsk(args.dateLocal);

    const [meetingRows, ideaRows, insightRows] = await Promise.all([
      this.prisma.meeting.findMany({
        where: {
          tenantId: args.tenantId,
          endedAt: { gte: dayStart, lt: dayEnd },
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          aiResult: { select: { summaryFast: true } },
        },
        take: 20,
        orderBy: { endedAt: 'asc' },
      }),
      this.prisma.idea.findMany({
        where: { tenantId: args.tenantId },
        select: {
          id: true,
          statement: true,
          weight: true,
          supporterCount: true,
        },
        orderBy: [{ weight: 'desc' }, { lastDiscussedAt: 'desc' }],
        take: 5,
      }),
      this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          status: { in: ['active', 'mitigating'] },
          severity: { in: ['high', 'critical'] },
        },
        select: { id: true, statement: true, severity: true, kind: true },
        orderBy: [{ severity: 'desc' }, { lastObservedAt: 'desc' }],
        take: 5,
      }),
    ]);

    let goalId: string | null = null;
    let goalName: string | null = null;
    let compass: DayCompanyPackage['compass'] = null;
    try {
      const primaryGoal = await this.prisma.goal.findFirst({
        where: { tenantId: args.tenantId, isPrimary: true },
        select: { id: true, name: true },
      });
      const goal =
        primaryGoal ??
        (await this.prisma.goal.findFirst({
          where: { tenantId: args.tenantId, status: 'active' },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, name: true },
        }));
      if (goal) {
        goalId = goal.id;
        goalName = goal.name;
        const snapshot = await this.prisma.goalAlignmentSnapshot.findFirst({
          where: { tenantId: args.tenantId, goalId: goal.id },
          orderBy: { createdAt: 'desc' },
          select: { score: true, delta: true, explanation: true, signals: true },
        });
        const sig = parseSnapshotSignals(snapshot?.signals);
        compass = {
          goalName: goal.name,
          score: snapshot ? snapshot.score : null,
          delta: snapshot?.delta ?? null,
          explanation: snapshot?.explanation ?? null,
          pro: sig.pro,
          contra: sig.contra,
        };
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: сбор компаса для пакета упал — деградирую без цели',
      );
    }

    let customersAtRisk: DayCompanyPackage['customersAtRisk'] = [];
    try {
      const top = await this.customerRisk.topForDigest({
        tenantId: args.tenantId,
        limit: 5,
      });
      customersAtRisk = top.map((c) => ({
        customerName: c.customerName,
        riskLevel: c.riskLevel,
        signals: buildCustomerRiskBadge(c.signalCounts),
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: клиенты под риском для пакета упали — пропускаю',
      );
    }

    let yesterday: DayCompanyPackage['yesterday'] = null;
    try {
      const prev = await this.getStored({
        tenantId: args.tenantId,
        dateLocal: previousDateLocal(args.dateLocal),
      });
      if (prev) {
        yesterday = {
          state: prev.verdict?.overall.state ?? null,
          title: prev.verdict?.overall.title ?? null,
          shortSummary: prev.shortSummary,
        };
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: вчерашний снапшот для пакета не получен — без петли',
      );
    }

    return {
      dateLocal: args.dateLocal,
      goalId,
      goalName,
      meetings: meetingRows.map((m) => ({
        id: m.id,
        title: m.title ?? 'Встреча',
        summary: m.aiResult?.summaryFast ?? null,
      })),
      topInsights: insightRows.map((i) => ({
        id: i.id,
        statement: (i.statement ?? '').slice(0, 400),
        severity: i.severity,
        kind: i.kind,
      })),
      topIdeas: ideaRows.map((i) => ({
        id: i.id,
        statement: (i.statement ?? '').slice(0, 400),
        weight: Number(i.weight),
        supporterCount: i.supporterCount,
      })),
      customersAtRisk,
      compass,
      yesterday,
    };
  }

  private async buildDailyTrend(
    tenantId: string,
    dateLocal: string,
    days = 14,
  ): Promise<DailyDigestTrendPointDto[]> {
    try {
      const rows = await this.prisma.dailyOperationsDigest.findMany({
        where: { tenantId, dateLocal: { lte: dateLocal } },
        orderBy: { dateLocal: 'desc' },
        take: days,
        select: { dateLocal: true, metricsJson: true },
      });
      return mapDailyDigestRowsToTrend(rows);
    } catch {
      return [];
    }
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    dateLocal: string;
    bodyMarkdown: string;
    metricsJson: unknown;
    sourcesJson: unknown;
    llmTaskRouteId: string | null;
    shortSummary: string | null;
    deliveredAt: Date | null;
    createdAt: Date;
    verdictJson?: unknown;
    letterJson?: unknown;
    goalAlignmentDayJson?: unknown;
  }): DailyOperationsDigestDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      dateLocal: row.dateLocal,
      bodyMarkdown: row.bodyMarkdown,
      shortSummary: row.shortSummary,
      metrics: (row.metricsJson as DailyDigestMetricsDto) ?? emptyMetrics(),
      sources: (row.sourcesJson as DailyDigestSourcesDto) ?? emptySources(),
      llmTaskRouteId: row.llmTaskRouteId,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      eventsToday: [],
      urgentItems: [],
      whoShined: [],
      whoStruggled: [],
      customersAtRisk: [],
      chronicBlockers: [],
      trend: [],
      verdict: (row.verdictJson as DailyDigestVerdictDto | null) ?? null,
      letter: (row.letterJson as DailyDigestLetterSectionDto[] | null) ?? null,
      goalAlignmentDay: (row.goalAlignmentDayJson as DailyDigestGoalAlignmentDayDto | null) ?? null,
    };
  }

  private async enrichDto(dto: DailyOperationsDigestDto): Promise<DailyOperationsDigestDto> {
    try {
      const sections = await this.computeRuntimeSections({
        tenantId: dto.tenantId,
        dateLocal: dto.dateLocal,
      });
      const trend = await this.buildDailyTrend(dto.tenantId, dto.dateLocal);
      return { ...dto, ...sections, trend };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: dto.tenantId,
          dateLocal: dto.dateLocal,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: computeRuntimeSections упал — возвращаю DTO без расширенных секций',
      );
      return dto;
    }
  }

  private async computeRuntimeSections(args: { tenantId: string; dateLocal: string }): Promise<{
    eventsToday: DailyDigestEventDto[];
    urgentItems: DailyDigestUrgentItemDto[];
    whoShined: DailyDigestPersonShinedDto[];
    whoStruggled: DailyDigestPersonStruggledDto[];
    customersAtRisk: DailyDigestCustomerAtRiskDto[];
    chronicBlockers: DailyDigestChronicBlockerDto[];
  }> {
    const [dayStart, dayEnd] = this.parseDayBoundsMsk(args.dateLocal);
    const now = new Date();

    const [
      meetingsToday,
      criticalSignals,
      overdueCommits,
      highInsights,
      redCheckIns,
      brokenCommits,
      recognitionsToday,
      helpfulnessToday,
      keptCommits,
      persons,
    ] = await Promise.all([
      this.prisma.meeting.findMany({
        where: {
          tenantId: args.tenantId,
          endedAt: { gte: dayStart, lt: dayEnd },
          deletedAt: null,
        },
        select: { id: true, title: true, endedAt: true, durationMs: true },
        take: 30,
        orderBy: { endedAt: 'asc' },
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: dayStart, lt: dayEnd },
          signalType: { in: ['churn_risk', 'risk', 'pain'] },
          confidence: { gte: new Prisma.Decimal(0.8) },
        },
        select: { id: true, name: true, signalType: true, createdAt: true },
        take: 10,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: { in: ['open', 'asked'] },
          commitmentDueDate: { lt: now },
        },
        select: { id: true, name: true, commitmentDueDate: true },
        take: 10,
        orderBy: { commitmentDueDate: 'asc' },
      }),
      this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          severity: 'high',
          status: { not: 'archived' },
          firstObservedAt: { gte: dayStart, lt: dayEnd },
        },
        select: { id: true, statement: true },
        take: 5,
        orderBy: { firstObservedAt: 'desc' },
      }),
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          sentiment: 'red',
          dateLocal: args.dateLocal,
        },
        select: {
          id: true,
          personId: true,
          sentimentRationale: true,
          person: { select: { id: true, name: true } },
        },
        take: 10,
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: 'missed',
          updatedAt: { gte: dayStart, lt: dayEnd },
        },
        select: {
          id: true,
          name: true,
          commitmentRecipient: { select: { id: true, name: true } },
        },
        take: 10,
      }),
      this.prisma.recognition.findMany({
        where: {
          tenantId: args.tenantId,
          createdAt: { gte: dayStart, lt: dayEnd },
        },
        select: { toUserId: true, type: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.helpfulnessSpotlight.findMany({
        where: {
          tenantId: args.tenantId,
          OR: [
            { periodFrom: { lte: dayEnd }, periodTo: { gte: dayStart } },
            { createdAt: { gte: dayStart, lt: dayEnd } },
          ],
        },
        select: { helperUserId: true, helpCount: true },
        orderBy: { helpCount: 'desc' },
        take: 20,
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'commitment',
          commitmentStatus: 'fulfilled',
          updatedAt: { gte: dayStart, lt: dayEnd },
          commitmentAuthorPersonId: { not: null },
        },
        select: {
          id: true,
          name: true,
          commitmentAuthorPersonId: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      }),
      this.prisma.person.findMany({
        where: { tenantId: args.tenantId, deletedAt: null },
        select: { id: true, name: true, userId: true },
      }),
    ]);

    const personById = new Map<string, string>(persons.map((p) => [p.id, p.name]));
    const personByUserId = new Map<string, { id: string; name: string }>();
    for (const p of persons) {
      if (p.userId && p.name) personByUserId.set(p.userId, { id: p.id, name: p.name });
    }

    const eventsToday: DailyDigestEventDto[] = [];
    for (const m of meetingsToday) {
      if (!m.endedAt) continue;
      const durationMin = m.durationMs ? Math.max(1, Math.round(m.durationMs / 60_000)) : null;
      eventsToday.push({
        kind: 'meeting',
        id: m.id,
        title: m.title ?? 'Встреча',
        occurredAt: m.endedAt.toISOString(),
        link: `/meetings/${encodeURIComponent(m.id)}/result`,
        ...(durationMin ? { detail: `${durationMin} мин` } : {}),
      });
    }
    for (const s of criticalSignals) {
      eventsToday.push({
        kind: 'signal',
        id: s.id,
        title: s.name,
        occurredAt: s.createdAt.toISOString(),
        link: `/themes?block=${encodeURIComponent(s.id)}`,
        detail: s.signalType,
      });
    }
    eventsToday.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    const urgentItems: DailyDigestUrgentItemDto[] = [];
    for (const c of overdueCommits) {
      const daysOverdue = c.commitmentDueDate
        ? Math.max(
            1,
            Math.floor((now.getTime() - c.commitmentDueDate.getTime()) / (24 * 60 * 60 * 1000)),
          )
        : 0;
      urgentItems.push({
        kind: 'overdue_commitment',
        id: c.id,
        title: (c.name ?? '').slice(0, 100),
        link: `/me/commitments?id=${encodeURIComponent(c.id)}`,
        badge: `просрочено на ${daysOverdue} ${daysOverdue === 1 ? 'день' : 'дн.'}`,
        urgency: daysOverdue >= 3 ? 'high' : 'medium',
      });
    }
    for (const i of highInsights) {
      urgentItems.push({
        kind: 'high_insight',
        id: i.id,
        title: (i.statement ?? '').slice(0, 100),
        link: `/insights?id=${encodeURIComponent(i.id)}`,
        badge: 'важный сигнал',
        urgency: 'medium',
      });
    }

    const shinedMap = new Map<string, DailyDigestPersonShinedDto>();

    const recognitionByUser = new Map<string, { count: number; lastType: string | null }>();
    for (const rec of recognitionsToday) {
      if (!rec.toUserId) continue;
      const prev = recognitionByUser.get(rec.toUserId);
      if (prev) {
        prev.count += 1;
      } else {
        recognitionByUser.set(rec.toUserId, {
          count: 1,
          lastType: rec.type ?? null,
        });
      }
    }
    for (const [userId, agg] of recognitionByUser) {
      const person = personByUserId.get(userId);
      if (!person) continue;
      if (shinedMap.has(person.id)) continue;
      shinedMap.set(person.id, {
        personId: person.id,
        personName: person.name,
        reason: 'recognition_received',
        detail: this.buildRecognitionDetail(agg.count, agg.lastType),
        link: `/persons/${encodeURIComponent(person.id)}`,
      });
    }

    const helpCountByUser = new Map<string, number>();
    for (const h of helpfulnessToday) {
      if (!h.helperUserId) continue;
      helpCountByUser.set(
        h.helperUserId,
        (helpCountByUser.get(h.helperUserId) ?? 0) + (h.helpCount ?? 0),
      );
    }
    for (const [userId, helpCount] of helpCountByUser) {
      const person = personByUserId.get(userId);
      if (!person) continue;
      if (shinedMap.has(person.id)) continue;
      const n = Math.max(1, helpCount);
      shinedMap.set(person.id, {
        personId: person.id,
        personName: person.name,
        reason: 'helpful_acts',
        detail: `помог ${n} ${pluralizeRaz(n)}`,
        link: `/persons/${encodeURIComponent(person.id)}`,
      });
    }

    const keptByAuthor = new Map<string, { count: number; lastName: string }>();
    for (const c of keptCommits) {
      const authorId = c.commitmentAuthorPersonId;
      if (!authorId) continue;
      const prev = keptByAuthor.get(authorId);
      if (prev) {
        prev.count += 1;
      } else {
        keptByAuthor.set(authorId, {
          count: 1,
          lastName: (c.name ?? '').trim(),
        });
      }
    }
    for (const [personId, agg] of keptByAuthor) {
      const name = personById.get(personId);
      if (!name) continue;
      if (shinedMap.has(personId)) continue;
      const detail =
        agg.count === 1 && agg.lastName
          ? `сдержал обещание: ${agg.lastName.slice(0, 80)}`
          : `закрыл ${agg.count} ${pluralizeObeshchanie(agg.count)}`;
      shinedMap.set(personId, {
        personId,
        personName: name,
        reason: 'commitments_kept',
        detail,
        link: `/persons/${encodeURIComponent(personId)}`,
      });
    }

    const whoShined = Array.from(shinedMap.values()).slice(0, 8);

    const struggledMap = new Map<string, DailyDigestPersonStruggledDto>();
    for (const r of redCheckIns) {
      const name = r.person?.name ?? personById.get(r.personId) ?? 'Без имени';
      if (!struggledMap.has(r.personId)) {
        struggledMap.set(r.personId, {
          personId: r.personId,
          personName: name,
          reason: 'red_checkin',
          detail: (r.sentimentRationale ?? '').slice(0, 120) || 'красный чек-ин',
          link: `/persons/${encodeURIComponent(r.personId)}`,
        });
      }
    }
    for (const c of brokenCommits) {
      if (!c.commitmentRecipient) continue;
      const pid = c.commitmentRecipient.id;
      if (struggledMap.has(pid)) continue;
      struggledMap.set(pid, {
        personId: pid,
        personName: c.commitmentRecipient.name ?? 'Без имени',
        reason: 'broken_commitment',
        detail: `Не выполнено: ${(c.name ?? '').slice(0, 80)}`,
        link: `/persons/${encodeURIComponent(pid)}`,
      });
    }
    const whoStruggled = Array.from(struggledMap.values()).slice(0, 8);

    let customersAtRisk: DailyDigestCustomerAtRiskDto[] = [];
    try {
      const top = await this.customerRisk.topForDigest({
        tenantId: args.tenantId,
        limit: 5,
      });
      customersAtRisk = top.map((c) => ({
        customerName: c.customerName,
        riskLevel: c.riskLevel === 'critical' ? 'critical' : 'warning',
        badge: buildCustomerRiskBadge(c.signalCounts),
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: секция «Клиенты под риском» упала — пропускаю',
      );
    }

    let chronicBlockers: DailyDigestChronicBlockerDto[] = [];
    try {
      const chronic = await this.blockerSynthesis.listChronicForTenant({
        tenantId: args.tenantId,
        limit: 5,
      });
      chronicBlockers = chronic.map((c) => ({
        id: c.id,
        representativeText: c.representativeText,
        status: c.status,
        daysOpen: c.daysOpen,
        linkedInsightId: c.linkedInsightId,
        responsiblePersonId: c.responsiblePersonId,
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: секция «Хронические блокеры» упала — пропускаю',
      );
    }

    return {
      eventsToday,
      urgentItems,
      whoShined,
      whoStruggled,
      customersAtRisk,
      chronicBlockers,
    };
  }

  private buildRecognitionDetail(count: number, lastType: string | null): string {
    const base = `${count} ${pluralizeBlagodarnost(count)}`;
    const human = lastType ? recognitionTypeRu(lastType) : null;
    if (human) return `${base} — ${human}`.slice(0, 120);
    return base.slice(0, 120);
  }

  private parseDayBoundsMsk(dateLocal: string): [Date, Date] {
    const [y, m, d] = dateLocal.split('-').map(Number);
    if (!y || !m || !d) {
      const end = new Date();
      const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
      return [start, end];
    }
    const start = new Date(Date.UTC(y, m - 1, d, -3, 0, 0));
    const end = new Date(Date.UTC(y, m - 1, d + 1, -3, 0, 0));
    return [start, end];
  }
}

function emptyMetrics(): DailyDigestMetricsDto {
  return {
    totalCheckIns: 0,
    greenShare: 0,
    yellowShare: 0,
    redShare: 0,
    topRedCheckIns: [],
    newBlockers: [],
    overdueCommitments: [],
    goals: {
      completed: 0,
      failed: 0,
      activated: 0,
      completedIds: [],
      failedIds: [],
    },
    newHighInsights: [],
  };
}

function emptySources(): DailyDigestSourcesDto {
  return {
    checkInIds: [],
    blockerIds: [],
    commitmentIds: [],
    goalIds: [],
    insightIds: [],
  };
}

function parseDateLocalToUtc(dateLocal: string): Date {
  return new Date(`${dateLocal}T00:00:00.000Z`);
}

function endOfDayUtc(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(23, 59, 59, 999);
  return c;
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs >= 11 && abs <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function pluralizeRaz(n: number): string {
  return pluralRu(n, 'раз', 'раза', 'раз');
}

function pluralizeBlagodarnost(n: number): string {
  return pluralRu(n, 'благодарность', 'благодарности', 'благодарностей');
}

function pluralizeObeshchanie(n: number): string {
  return pluralRu(n, 'обещание', 'обещания', 'обещаний');
}

function parseSnapshotSignals(raw: unknown): { pro: string[]; contra: string[] } {
  if (!raw || typeof raw !== 'object') return { pro: [], contra: [] };
  const obj = raw as Record<string, unknown>;
  const pro = Array.isArray(obj.pro)
    ? obj.pro.filter((x): x is string => typeof x === 'string')
    : [];
  const contra = Array.isArray(obj.contra)
    ? obj.contra.filter((x): x is string => typeof x === 'string')
    : [];
  return { pro, contra };
}

function buildCustomerRiskBadge(counts: {
  churn_risk: number;
  objection: number;
  pain: number;
  feature_request: number;
}): string {
  const parts: string[] = [];
  if (counts.churn_risk > 0) parts.push(`отток ×${counts.churn_risk}`);
  if (counts.objection > 0) parts.push(`возражения ×${counts.objection}`);
  if (counts.pain > 0) parts.push(`боли ×${counts.pain}`);
  if (counts.feature_request > 0) parts.push(`доработки ×${counts.feature_request}`);
  return parts.join(', ') || 'сигналы';
}

function recognitionTypeRu(type: string): string | null {
  switch (type) {
    case 'thanks_comment':
      return 'спасибо за комментарий';
    case 'thanks_helpfulness':
      return 'спасибо за помощь';
    case 'mention_helped':
      return 'отметили, что помог';
    case 'idea_shipped':
      return 'идея пошла в дело';
    case 'streak_milestone':
      return 'серия активности';
    case 'weekly_summary':
      return 'итоги недели';
    default:
      return null;
  }
}
