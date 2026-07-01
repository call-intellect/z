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
  type DayCompanyEmployeeVoice,
  type DayCompanyEmployeeVoiceItem,
  type DayCompanyPackage,
  type DayCompanyRawConversations,
  type DayCompanyRawSession,
  type DayCompanyRawTurn,
  type DayCompanyReporting,
  type DayCompanyReportingPerson,
  type DayCompanyResponse,
  type DayCompanySignals,
  type DayCompanyYesterdaySignal,
} from '../prompts/daily-digest.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import { BlockerSynthesisService } from './blocker-synthesis.service';
import { CustomerRiskRadarService } from './customer-risk-radar.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { PersonRefResolverService } from './person-ref-resolver.service';

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
        goalsCompleted: Number(goals.completed ?? 0),
        goalsFailed: Number(goals.failed ?? 0),
      };
    })
    .reverse();
}

export function computeVerdictSignals(
  metrics: DailyDigestMetricsDto,
  pkg: DayCompanyPackage,
): DayVerdictSignals {
  const criticalCustomer = pkg.customersAtRisk.some((c) => c.riskLevel === 'critical');
  const severeInsight = pkg.topInsights.some(
    (i) => i.severity === 'high' || i.severity === 'critical',
  );
  const hasNegativeClientSignal = criticalCustomer || severeInsight;

  const executionStrained = metrics.newBlockers.some((b) => b.confidence >= 0.8);

  return { hasNegativeClientSignal, executionStrained };
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
    @Inject(PersonRefResolverService)
    private readonly personRefResolver: PersonRefResolverService,
    @Inject(OperationsDashboardService)
    private readonly opsDashboard: OperationsDashboardService,
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
    const signals = computeVerdictSignals(aggregates.metrics, pkg);

    let bodyMarkdown: string;
    let shortSummary: string | null;
    let llmTaskRouteId: string | null;
    let verdictObj: DailyDigestVerdictDto | null;
    let letterArr: DailyDigestLetterSectionDto[] | null;
    let goalDayObj: DailyDigestGoalAlignmentDayDto | null;
    let risksSummary: string | null;
    let ideasSummary: string | null;
    const userMessage = buildDayCompanyUserMessage(pkg, aggregates.metrics, args.dateLocal);
    this.metrics.setCooDailyDigestPackageChars({ tenantTop, value: userMessage.length });
    this.metrics.setCooDailyDigestConflictsFed({ tenantTop, value: pkg.conflicts.length });
    try {
      const result = await this.llm.call({
        taskType: DAILY_DIGEST_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: DAY_COMPANY_SYSTEM_PROMPT,
        userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'DayCompany',
          schema: DAY_COMPANY_JSON_SCHEMA,
          strict: true,
        },
        reasoningEffort: 'high',
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
      this.metrics.incCooDailyDigestModelUsed({ tenantTop, model: result.modelUsed });
      this.logger.log(
        {
          tenantId: args.tenantId,
          dateLocal: args.dateLocal,
          packageChars: userMessage.length,
          conflicts: pkg.conflicts.length,
          employeeVoice: pkg.employeeVoice.length,
          model: result.modelUsed,
        },
        'daily-digest: пакет v2 собран и отправлен в LLM',
      );
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

    const [checkIns, redCheckIns, newBlockers, goalsChanged, highInsights] = await Promise.all([
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
      commitmentIds: [],
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
    const resolver = await this.personRefResolver.create(args.tenantId);

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

    const employeeVoice = await this.collectEmployeeVoice({
      tenantId: args.tenantId,
      dayStart,
      dayEnd,
      resolver,
    });
    const rawConversations = await this.collectRawConversations({
      tenantId: args.tenantId,
      dayStart,
      dayEnd,
      resolver,
    });
    const signals = await this.collectSignals({
      tenantId: args.tenantId,
      dayStart,
      dayEnd,
    });
    const conflicts = await this.collectConflicts({
      tenantId: args.tenantId,
      dayStart,
    });
    const reporting = await this.collectReporting({
      tenantId: args.tenantId,
      dateLocal: args.dateLocal,
    });
    const yesterdayOpenSignals = await this.collectYesterdayOpenSignals({
      tenantId: args.tenantId,
      dateLocal: args.dateLocal,
    });

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
      employeeVoice,
      rawConversations,
      signals,
      conflicts,
      reporting,
      yesterdayOpenSignals,
    };
  }

  private async collectEmployeeVoice(args: {
    tenantId: string;
    dayStart: Date;
    dayEnd: Date;
    resolver: Awaited<ReturnType<PersonRefResolverService['create']>>;
  }): Promise<DayCompanyEmployeeVoice[]> {
    try {
      const rows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          tenantId: args.tenantId,
          authorPersonId: { not: null },
          sourceTimestamp: { gte: args.dayStart, lt: args.dayEnd },
        },
        select: {
          authorPersonId: true,
          sourceTimestamp: true,
          block: {
            select: { signalType: true, name: true, trustedAnswer: true },
          },
        },
        take: 500,
      });

      const byPerson = new Map<
        string,
        {
          ideas: DayCompanyEmployeeVoiceItem[];
          risks: DayCompanyEmployeeVoiceItem[];
          other: DayCompanyEmployeeVoiceItem[];
          seen: Set<string>;
        }
      >();

      for (const row of rows) {
        const personId = row.authorPersonId;
        if (!personId || !row.block) continue;
        const signalType = row.block.signalType;
        const bucket = employeeVoiceBucket(signalType);
        if (bucket === null) continue;
        const text = (row.block.trustedAnswer?.trim() || row.block.name).slice(0, 300);
        if (!text) continue;
        let entry = byPerson.get(personId);
        if (!entry) {
          entry = { ideas: [], risks: [], other: [], seen: new Set() };
          byPerson.set(personId, entry);
        }
        if (entry.seen.has(text)) continue;
        entry.seen.add(text);
        entry[bucket].push({ text, signalType });
      }

      const result: DayCompanyEmployeeVoice[] = [];
      for (const [personId, entry] of byPerson) {
        const personName =
          args.resolver.resolve({ personId, source: 'chat' }).personName ?? 'Сотрудник';
        result.push({
          personId,
          personName,
          ideas: entry.ideas,
          risks: entry.risks,
          other: entry.other,
        });
      }
      result.sort(
        (a, b) =>
          b.ideas.length +
          b.risks.length +
          b.other.length -
          (a.ideas.length + a.risks.length + a.other.length),
      );
      return result.slice(0, 12);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: голос сотрудников для пакета упал — пропускаю',
      );
      return [];
    }
  }

  private async collectRawConversations(args: {
    tenantId: string;
    dayStart: Date;
    dayEnd: Date;
    resolver: Awaited<ReturnType<PersonRefResolverService['create']>>;
  }): Promise<DayCompanyRawConversations> {
    let bitrix: DayCompanyRawSession[] = [];
    let chatbox: DayCompanyRawSession[] = [];

    try {
      const rows = await this.prisma.bitrixMessage.findMany({
        where: {
          tenantId: args.tenantId,
          externalCreatedAt: { gte: args.dayStart, lt: args.dayEnd },
          text: { not: null },
        },
        select: {
          sessionId: true,
          dialogId: true,
          authorExternalId: true,
          authorName: true,
          externalCreatedAt: true,
          text: true,
        },
        orderBy: { externalCreatedAt: 'asc' },
        take: 1000,
      });
      const bySession = new Map<string, DayCompanyRawTurn[]>();
      for (const row of rows) {
        if (!row.text) continue;
        const ref = args.resolver.resolve({
          source: 'bitrix',
          externalId: row.authorExternalId,
        });
        const turn: DayCompanyRawTurn = {
          author: row.authorName ?? 'сотрудник',
          personId: ref.personId,
          isClient: false,
          ts: row.externalCreatedAt.toISOString(),
          text: row.text.slice(0, 500),
        };
        const key = row.sessionId ?? row.dialogId;
        const turns = bySession.get(key);
        if (turns) turns.push(turn);
        else bySession.set(key, [turn]);
      }
      bitrix = Array.from(bySession, ([session, turns]) => ({ session, turns }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: сырые переписки Битрикс упали — пропускаю',
      );
    }

    try {
      const rows = await this.prisma.chatboxMessage.findMany({
        where: {
          tenantId: args.tenantId,
          externalCreatedAt: { gte: args.dayStart, lt: args.dayEnd },
          text: { not: null },
        },
        select: {
          sessionId: true,
          chatId: true,
          senderType: true,
          senderExternalId: true,
          senderName: true,
          externalCreatedAt: true,
          text: true,
        },
        orderBy: { externalCreatedAt: 'asc' },
        take: 1000,
      });
      const bySession = new Map<string, DayCompanyRawTurn[]>();
      for (const row of rows) {
        if (!row.text) continue;
        if (row.senderType === 'ASSISTANT' || row.senderType === 'QUALITY_CONTROL') continue;
        const isClient = row.senderType === 'CLIENT';
        const ref = args.resolver.resolve({
          source: 'chatbox',
          externalId: row.senderExternalId,
          isClient,
        });
        const turn: DayCompanyRawTurn = {
          author: row.senderName ?? (isClient ? 'клиент' : 'сотрудник'),
          personId: ref.personId,
          isClient: ref.isClient,
          ts: row.externalCreatedAt.toISOString(),
          text: row.text.slice(0, 500),
        };
        const key = row.sessionId ?? row.chatId;
        const turns = bySession.get(key);
        if (turns) turns.push(turn);
        else bySession.set(key, [turn]);
      }
      chatbox = Array.from(bySession, ([session, turns]) => ({ session, turns }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'daily-digest: сырые переписки чатбокса упали — пропускаю',
      );
    }

    const budget = await this.cfg.getDynamic<number>(
      'operations.daily_digest.raw_char_budget',
      'COO_DAILY_DIGEST_RAW_CHAR_BUDGET',
      40000,
    );
    return trimRawConversations({ bitrix, chatbox }, budget);
  }

  private async collectSignals(args: {
    tenantId: string;
    dayStart: Date;
    dayEnd: Date;
  }): Promise<DayCompanySignals> {
    const signals: DayCompanySignals = { blockers: [], risks: [], ideas: [] };
    try {
      const blockers = await this.prisma.ideaBlock.findMany({
        where: {
          tenantId: args.tenantId,
          signalType: 'blocker',
          createdAt: { gte: args.dayStart, lt: args.dayEnd },
        },
        select: { name: true, confidence: true },
        orderBy: [{ confidence: 'desc' }],
        take: 10,
      });
      signals.blockers = blockers.map((b) => ({
        text: b.name.slice(0, 300),
        confidence: Number(b.confidence),
      }));
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'daily-digest: блокеры-сигналы для пакета упали — пропускаю',
      );
    }

    try {
      const risks = await this.prisma.insight.findMany({
        where: {
          tenantId: args.tenantId,
          status: { in: ['active', 'mitigating'] },
          severity: { in: ['high', 'critical'] },
        },
        select: {
          statement: true,
          causeCategory: true,
          dynamicLabel: true,
          sourceBlockIds: true,
          frequencyScore: true,
          status: true,
          severity: true,
        },
        orderBy: [{ severity: 'desc' }, { lastObservedAt: 'desc' }],
        take: 12,
      });
      signals.risks = risks.map((i) => ({
        text: (i.statement ?? '').slice(0, 300),
        causeCategory: i.causeCategory,
        dynamicLabel: i.dynamicLabel,
        observations: i.sourceBlockIds.length,
        frequencyScore: Number(i.frequencyScore),
        status: i.status,
        severity: i.severity,
      }));
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'daily-digest: риски-сигналы для пакета упали — пропускаю',
      );
    }

    try {
      const ideas = await this.prisma.idea.findMany({
        where: {
          tenantId: args.tenantId,
          status: { notIn: ['rejected', 'archived'] },
        },
        select: {
          statement: true,
          supporterCount: true,
          weight: true,
          status: true,
          clusterId: true,
        },
        orderBy: [{ weight: 'desc' }],
        take: 12,
      });
      signals.ideas = ideas.map((i) => ({
        text: (i.statement ?? '').slice(0, 300),
        supporterCount: i.supporterCount,
        weight: Number(i.weight),
        status: i.status,
        clusterId: i.clusterId,
      }));
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'daily-digest: идеи-сигналы для пакета упали — пропускаю',
      );
    }

    return signals;
  }

  private async collectConflicts(args: {
    tenantId: string;
    dayStart: Date;
  }): Promise<DayCompanyPackage['conflicts']> {
    try {
      const frictions = await this.opsDashboard.getTeamFrictions({
        tenantId: args.tenantId,
        since: args.dayStart,
        limit: 20,
      });
      return frictions.items.map((f) => ({
        fromPersonName: f.fromPersonName,
        toPersonName: f.toPersonName,
        confidence: f.confidence,
        explanation: f.explanation,
        since: f.observedAt,
      }));
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'daily-digest: конфликты для пакета упали — пропускаю',
      );
      return [];
    }
  }

  private async collectReporting(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DayCompanyReporting> {
    const empty: DayCompanyReporting = {
      planSubmitted: { done: 0, total: 0 },
      reportSubmitted: { done: 0, total: 0 },
      perPerson: [],
      noReport: [],
      tasksSet: 0,
      tasksDone: 0,
      dayPlan: { done: 0, total: 0 },
    };
    try {
      const [checkIns, employees] = await Promise.all([
        this.prisma.dailyCheckIn.findMany({
          where: { tenantId: args.tenantId, dateLocal: args.dateLocal },
          select: {
            personId: true,
            kind: true,
            plansJson: true,
            donesJson: true,
            notDoneJson: true,
            reportCompleteness: true,
            person: { select: { name: true, relationship: true } },
          },
        }),
        this.prisma.person.findMany({
          where: { tenantId: args.tenantId, deletedAt: null, relationship: 'employee' },
          select: { id: true, name: true },
        }),
      ]);

      const employeeIds = new Set(employees.map((e) => e.id));
      const nameById = new Map(employees.map((e) => [e.id, e.name]));

      const perPersonAgg = new Map<
        string,
        {
          personName: string;
          planSubmitted: boolean;
          reportSubmitted: boolean;
          planned: number;
          done: number;
          mismatchReason?: string;
        }
      >();

      for (const ci of checkIns) {
        const name = ci.person?.name ?? nameById.get(ci.personId) ?? 'Без имени';
        let agg = perPersonAgg.get(ci.personId);
        if (!agg) {
          agg = {
            personName: name,
            planSubmitted: false,
            reportSubmitted: false,
            planned: 0,
            done: 0,
          };
          perPersonAgg.set(ci.personId, agg);
        }
        const plannedCount = jsonArrayLength(ci.plansJson);
        const doneCount = jsonArrayLength(ci.donesJson);
        const notDoneCount = jsonArrayLength(ci.notDoneJson);
        if (ci.kind === 'morning' && plannedCount > 0) {
          agg.planSubmitted = true;
          agg.planned = plannedCount;
        }
        if (ci.kind === 'evening' && (doneCount > 0 || notDoneCount > 0)) {
          agg.reportSubmitted = true;
          agg.done = doneCount;
          if (agg.planned > agg.done && notDoneCount > 0) {
            const firstNotDone = jsonArrayFirstText(ci.notDoneJson);
            if (firstNotDone) agg.mismatchReason = firstNotDone.slice(0, 200);
          }
        }
      }

      let planDone = 0;
      let reportDone = 0;
      let tasksSet = 0;
      let tasksDone = 0;
      const perPerson: DayCompanyReportingPerson[] = [];
      const reportedPersonIds = new Set<string>();

      for (const [personId, agg] of perPersonAgg) {
        if (employeeIds.has(personId)) {
          if (agg.planSubmitted) planDone++;
          if (agg.reportSubmitted) reportDone++;
          if (agg.reportSubmitted) reportedPersonIds.add(personId);
        }
        tasksSet += agg.planned;
        tasksDone += agg.done;
        perPerson.push({
          personName: agg.personName,
          planSubmitted: agg.planSubmitted,
          reportSubmitted: agg.reportSubmitted,
          planned: agg.planned,
          done: agg.done,
          ...(agg.mismatchReason ? { mismatchReason: agg.mismatchReason } : {}),
        });
      }

      const noReport = employees
        .filter((e) => !reportedPersonIds.has(e.id))
        .map((e) => e.name);

      return {
        planSubmitted: { done: planDone, total: employees.length },
        reportSubmitted: { done: reportDone, total: employees.length },
        perPerson,
        noReport,
        tasksSet,
        tasksDone,
        dayPlan: { done: tasksDone, total: tasksSet },
      };
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'daily-digest: план↔факт (reporting) для пакета упал — пропускаю',
      );
      return empty;
    }
  }

  private async collectYesterdayOpenSignals(args: {
    tenantId: string;
    dateLocal: string;
  }): Promise<DayCompanyYesterdaySignal[]> {
    try {
      const prev = await this.getStored({
        tenantId: args.tenantId,
        dateLocal: previousDateLocal(args.dateLocal),
      });
      if (!prev) return [];
      const out: DayCompanyYesterdaySignal[] = [];
      const axes = prev.verdict?.axes ?? [];
      for (const axis of axes) {
        if (axis.state !== 'ok') {
          out.push({ text: axis.why, axis: axis.key, state: axis.state });
        }
      }
      const risksSummary = prev.metrics?.risksSummary;
      if (typeof risksSummary === 'string' && risksSummary.trim()) {
        out.push({ text: risksSummary, axis: 'overall', state: 'warn' });
      }
      return out;
    } catch (err) {
      this.logger.warn(
        { tenantId: args.tenantId, err: err instanceof Error ? err.message : String(err) },
        'daily-digest: вчерашние открытые сигналы для пакета упали — пропускаю',
      );
      return [];
    }
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

    const [
      meetingsToday,
      criticalSignals,
      highInsights,
      redCheckIns,
      recognitionsToday,
      helpfulnessToday,
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

const EMPLOYEE_VOICE_IDEA_TYPES = new Set(['idea', 'suggestion', 'hypothesis']);
const EMPLOYEE_VOICE_RISK_TYPES = new Set([
  'risk',
  'pain',
  'churn_risk',
  'blocker',
  'team_friction',
  'process_friction',
]);
const EMPLOYEE_VOICE_SKIP_TYPES = new Set(['fact', 'mood']);

function employeeVoiceBucket(signalType: string): 'ideas' | 'risks' | 'other' | null {
  if (EMPLOYEE_VOICE_IDEA_TYPES.has(signalType)) return 'ideas';
  if (EMPLOYEE_VOICE_RISK_TYPES.has(signalType)) return 'risks';
  if (EMPLOYEE_VOICE_SKIP_TYPES.has(signalType)) return null;
  return 'other';
}

function jsonArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function jsonArrayFirstText(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = value[0];
  if (first && typeof first === 'object' && 'text' in first) {
    const text = (first as { text?: unknown }).text;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return null;
}

function trimRawConversations(
  conversations: DayCompanyRawConversations,
  budget: number,
): DayCompanyRawConversations {
  const total =
    sumTurnsChars(conversations.bitrix) + sumTurnsChars(conversations.chatbox);
  if (total <= budget) return conversations;

  const flat: Array<{ channel: 'bitrix' | 'chatbox'; session: string; turn: DayCompanyRawTurn }> =
    [];
  for (const s of conversations.bitrix) {
    for (const t of s.turns) flat.push({ channel: 'bitrix', session: s.session, turn: t });
  }
  for (const s of conversations.chatbox) {
    for (const t of s.turns) flat.push({ channel: 'chatbox', session: s.session, turn: t });
  }
  flat.sort((a, b) => a.turn.ts.localeCompare(b.turn.ts));

  let used = flat.reduce((acc, x) => acc + x.turn.text.length, 0);
  let cut = 0;
  while (used > budget && cut < flat.length) {
    used -= flat[cut]!.turn.text.length;
    cut++;
  }
  const kept = flat.slice(cut);

  const rebuild = (channel: 'bitrix' | 'chatbox'): DayCompanyRawSession[] => {
    const bySession = new Map<string, DayCompanyRawTurn[]>();
    for (const x of kept) {
      if (x.channel !== channel) continue;
      const turns = bySession.get(x.session);
      if (turns) turns.push(x.turn);
      else bySession.set(x.session, [x.turn]);
    }
    return Array.from(bySession, ([session, turns]) => ({ session, turns }));
  };

  return { bitrix: rebuild('bitrix'), chatbox: rebuild('chatbox') };
}

function sumTurnsChars(sessions: DayCompanyRawSession[]): number {
  let sum = 0;
  for (const s of sessions) {
    for (const t of s.turns) sum += t.text.length;
  }
  return sum;
}
