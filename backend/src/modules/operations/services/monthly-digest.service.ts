import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  mapAvailablePeriod,
  type AvailablePeriodsDto,
} from '../dto/available-periods.dto';
import type {
  MonthlyDigestGoalAlignmentMonthDto,
  MonthlyDigestLetterSectionDto,
  MonthlyDigestMetricsDto,
  MonthlyDigestSourcesDto,
  MonthlyDigestVerdictDto,
  MonthlyOperationsDigestDto,
  MonthWeekTrendAxisDto,
} from '../dto/monthly-digest.dto';
import {
  MONTH_COMPANY_JSON_SCHEMA,
  MONTH_COMPANY_PROMPT_VERSION,
  MONTH_COMPANY_SYSTEM_PROMPT,
  MONTHLY_DIGEST_TASK_TYPE,
  buildFallbackMonthMarkdown,
  buildMonthCompanyUserMessage,
  buildMonthWeekTrend,
  clampMonthVerdict,
  computeMonthVerdictSignals,
  extractMonthCompanyResponse,
  monthCompanyToBodyMarkdown,
  type MonthCompanyPackage,
  type MonthCompanyPackageWeek,
} from '../prompts/monthly-digest.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import { monthBounds, shiftPeriod } from './value-recap.service';
import { WeeklyPerPersonService } from './weekly-per-person.service';

function formatDateUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function mondaysInMonth(periodYm: string): string[] {
  const { from, to } = monthBounds(periodYm);
  const out: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 0, 0, 0, 0),
  );
  const lastDay = to.getUTCDate();
  while (cursor.getUTCDate() <= lastDay && cursor.getUTCMonth() === from.getUTCMonth()) {
    if (cursor.getUTCDay() === 1) out.push(formatDateUtc(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function emptyMetrics(): MonthlyDigestMetricsDto {
  return {
    weeksCount: 0,
    missingWeeks: [],
    avgGreenShare: 0,
    avgRedShare: 0,
    totalCheckIns: 0,
    goalsCompleted: 0,
    goalsFailed: 0,
    topBlockers: [],
    reliabilityPercent: null,
    tasksDone: 0,
    tasksPlanned: 0,
    tasksNotDone: 0,
  };
}

function emptySources(): MonthlyDigestSourcesDto {
  return { weeklyDigestIds: [], goalIds: [] };
}

function normalizeVerdictState(raw: unknown): 'ok' | 'warn' | 'risk' | null {
  return raw === 'ok' || raw === 'warn' || raw === 'risk' ? raw : null;
}

function parseWeekVerdict(raw: unknown): {
  overallState: 'ok' | 'warn' | 'risk' | null;
  title: string | null;
  oneLiner: string | null;
  axes: MonthCompanyPackageWeek['axes'];
} {
  if (!raw || typeof raw !== 'object') {
    return { overallState: null, title: null, oneLiner: null, axes: [] };
  }
  const obj = raw as Record<string, unknown>;
  const overall =
    obj.overall && typeof obj.overall === 'object'
      ? (obj.overall as Record<string, unknown>)
      : {};
  const overallState = normalizeVerdictState(overall.state);
  const title = typeof overall.title === 'string' ? overall.title : null;
  const oneLiner = typeof overall.oneLiner === 'string' ? overall.oneLiner : null;

  const axes: MonthCompanyPackageWeek['axes'] = [];
  if (Array.isArray(obj.axes)) {
    for (const a of obj.axes) {
      if (!a || typeof a !== 'object') continue;
      const axis = a as Record<string, unknown>;
      const key = axis.key;
      const state = normalizeVerdictState(axis.state);
      if (
        (key === 'team' || key === 'clients' || key === 'execution' || key === 'overall') &&
        state !== null
      ) {
        axes.push({ key, state });
      }
    }
  }
  return { overallState, title, oneLiner, axes };
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

function readNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

interface WeeklyMetricsSlice {
  greenShare: number;
  redShare: number;
  totalCheckIns: number;
  goalsCompleted: number;
  goalsFailed: number;
  topBlockers: Array<{ text: string; count: number }>;
}

function parseWeeklyMetrics(raw: unknown): WeeklyMetricsSlice {
  const m = (raw ?? {}) as Record<string, unknown>;
  const goals = (m.goals ?? {}) as Record<string, unknown>;
  const topBlockers: Array<{ text: string; count: number }> = [];
  if (Array.isArray(m.topBlockers)) {
    for (const b of m.topBlockers) {
      if (!b || typeof b !== 'object') continue;
      const obj = b as Record<string, unknown>;
      const text = typeof obj.text === 'string' ? obj.text : null;
      if (!text) continue;
      topBlockers.push({ text, count: readNumber(obj.count) });
    }
  }
  return {
    greenShare: readNumber(m.greenShare),
    redShare: readNumber(m.redShare),
    totalCheckIns: readNumber(m.totalCheckIns),
    goalsCompleted: readNumber(goals.completed),
    goalsFailed: readNumber(goals.failed),
    topBlockers,
  };
}

function mergeBlockers(
  slices: WeeklyMetricsSlice[],
): Array<{ text: string; count: number }> {
  const byText = new Map<string, number>();
  for (const s of slices) {
    for (const b of s.topBlockers) {
      byText.set(b.text, (byText.get(b.text) ?? 0) + b.count);
    }
  }
  return Array.from(byText.entries())
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

@Injectable()
export class MonthlyDigestService {
  private readonly logger = new Logger(MonthlyDigestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(WeeklyPerPersonService)
    private readonly perPerson: WeeklyPerPersonService,
  ) {}

  async getStored(args: {
    tenantId: string;
    periodYm: string;
  }): Promise<MonthlyOperationsDigestDto | null> {
    const row = await this.prisma.monthlyOperationsDigest.findUnique({
      where: { tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm } },
    });
    if (!row) return null;
    return this.toDto(row);
  }

  async getLatest(args: { tenantId: string }): Promise<MonthlyOperationsDigestDto | null> {
    const row = await this.prisma.monthlyOperationsDigest.findFirst({
      where: { tenantId: args.tenantId },
      orderBy: { periodYm: 'desc' },
    });
    if (!row) return null;
    return this.toDto(row);
  }

  async listAvailablePeriods(args: {
    tenantId: string;
    limit: number;
  }): Promise<AvailablePeriodsDto> {
    const rows = await this.prisma.monthlyOperationsDigest.findMany({
      where: { tenantId: args.tenantId },
      orderBy: { periodYm: 'desc' },
      take: args.limit,
      select: { periodYm: true, verdictJson: true },
    });
    const periods = rows.map((r) => mapAvailablePeriod(r.periodYm, r.verdictJson));
    return { rhythm: 'month', periods, latest: periods[0]?.period ?? null };
  }

  async getOrGenerate(args: {
    tenantId: string;
    periodYm: string;
  }): Promise<MonthlyOperationsDigestDto> {
    const existing = await this.getStored(args);
    if (existing) return existing;
    return this.generate(args);
  }

  async generate(args: {
    tenantId: string;
    periodYm: string;
  }): Promise<MonthlyOperationsDigestDto> {
    const tenantTop = resolveOperationsTenantTop(args.tenantId);
    const { from, to } = monthBounds(args.periodYm);
    const fromStr = formatDateUtc(from);
    const toStr = formatDateUtc(to);

    const built = await this.buildMonthPackage({
      tenantId: args.tenantId,
      periodYm: args.periodYm,
      from: fromStr,
      to: toStr,
    });
    const pkg = built.pkg;

    const weekStarts = mondaysInMonth(args.periodYm);
    const weekTrend = buildMonthWeekTrend(pkg.weeks, weekStarts);
    const signals = computeMonthVerdictSignals(pkg);

    let bodyMarkdown: string;
    let llmTaskRouteId: string | null;
    let verdictObj: MonthlyDigestVerdictDto | null;
    let letterArr: MonthlyDigestLetterSectionDto[] | null;
    let goalMonthObj: MonthlyDigestGoalAlignmentMonthDto | null;
    let decisions: Array<{ title: string; why: string }> | null;
    let nextFocus: Array<{ title: string; why: string }> | null;
    let risksSummary: string | null;
    let ideasSummary: string | null;
    let shortSummary: string | null;
    try {
      const result = await this.llm.call({
        taskType: MONTHLY_DIGEST_TASK_TYPE,
        tenantId: args.tenantId,
        systemPrompt: MONTH_COMPANY_SYSTEM_PROMPT,
        userMessage: buildMonthCompanyUserMessage(pkg),
        responseFormat: {
          type: 'json_schema',
          name: 'MonthCompany',
          schema: MONTH_COMPANY_JSON_SCHEMA,
          strict: true,
        },
        reasoningEffort: 'high',
        maxTokens: 8_000,
        sourceRef: { type: 'monthly-digest', id: `${args.tenantId}:${args.periodYm}` },
      });
      const validated = extractMonthCompanyResponse(result);
      if (!validated) throw new Error('schema_mismatch');
      const verdict = clampMonthVerdict(validated.verdict, signals);
      goalMonthObj = {
        direction: validated.goalAlignmentMonth.direction,
        score: validated.goalAlignmentMonth.score,
        monthDelta: validated.goalAlignmentMonth.monthDelta,
        why: validated.goalAlignmentMonth.why,
        pro: validated.goalAlignmentMonth.pro,
        contra: validated.goalAlignmentMonth.contra,
        pace: {
          factToGoal: pkg.pace?.factToGoal ?? null,
          planToGoal: pkg.pace?.planToGoal ?? null,
          etaIso: pkg.pace?.etaIso ?? null,
          leadingSignal: validated.goalAlignmentMonth.leadingSignal || null,
        },
        goalId: pkg.goalId ?? null,
        goalName: pkg.goalName ?? null,
      };
      verdictObj = verdict;
      letterArr = validated.letter;
      decisions = validated.decisions;
      nextFocus = validated.nextFocus;
      risksSummary = validated.risksSummary;
      ideasSummary = validated.ideasSummary;
      shortSummary = verdict.overall.oneLiner || null;
      bodyMarkdown = monthCompanyToBodyMarkdown(verdict, validated.letter);
      llmTaskRouteId = `${MONTH_COMPANY_PROMPT_VERSION}+${result.modelUsed}`;
    } catch (err) {
      this.metrics.incCooMonthlyDigestFailed({ tenantTop, reason: 'llm_failed' });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          periodYm: args.periodYm,
          err: err instanceof Error ? err.message : String(err),
        },
        'monthly-digest: LLM упал — сохраняю «сухой» вариант',
      );
      bodyMarkdown = buildFallbackMonthMarkdown(pkg);
      verdictObj = null;
      letterArr = null;
      goalMonthObj = null;
      decisions = null;
      nextFocus = null;
      risksSummary = null;
      ideasSummary = null;
      shortSummary = null;
      llmTaskRouteId = null;
    }

    const greenShares = built.weeklyMetrics.map((m) => m.greenShare);
    const redShares = built.weeklyMetrics.map((m) => m.redShare);
    const avg = (xs: number[]): number =>
      xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

    const metricsToStore: MonthlyDigestMetricsDto = {
      weeksCount: pkg.weeks.length,
      missingWeeks: pkg.missingWeeks,
      avgGreenShare: avg(greenShares),
      avgRedShare: avg(redShares),
      totalCheckIns: built.weeklyMetrics.reduce((s, m) => s + m.totalCheckIns, 0),
      goalsCompleted: built.weeklyMetrics.reduce((s, m) => s + m.goalsCompleted, 0),
      goalsFailed: built.weeklyMetrics.reduce((s, m) => s + m.goalsFailed, 0),
      topBlockers: mergeBlockers(built.weeklyMetrics),
      reliabilityPercent: pkg.team.reliabilityPercent,
      tasksDone: pkg.team.tasksDone,
      tasksPlanned: pkg.team.tasksPlanned,
      tasksNotDone: pkg.team.tasksNotDone,
      ...(decisions ? { decisions } : {}),
      ...(nextFocus ? { nextFocus } : {}),
      risksSummary,
      ideasSummary,
    };

    const sourcesToStore: MonthlyDigestSourcesDto = {
      weeklyDigestIds: built.weeklyDigestIds,
      goalIds: pkg.goalId ? [pkg.goalId] : [],
    };

    const row = await this.prisma.monthlyOperationsDigest.upsert({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
      create: {
        tenantId: args.tenantId,
        periodYm: args.periodYm,
        bodyMarkdown,
        metricsJson: metricsToStore as unknown as Prisma.InputJsonValue,
        sourcesJson: sourcesToStore as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
        shortSummary,
        verdictJson: verdictObj
          ? (verdictObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        letterJson: letterArr ? (letterArr as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        goalAlignmentMonthJson: goalMonthObj
          ? (goalMonthObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        weekTrendJson: weekTrend as unknown as Prisma.InputJsonValue,
      },
      update: {
        bodyMarkdown,
        metricsJson: metricsToStore as unknown as Prisma.InputJsonValue,
        sourcesJson: sourcesToStore as unknown as Prisma.InputJsonValue,
        llmTaskRouteId,
        shortSummary,
        verdictJson: verdictObj
          ? (verdictObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        letterJson: letterArr ? (letterArr as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        goalAlignmentMonthJson: goalMonthObj
          ? (goalMonthObj as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        weekTrendJson: weekTrend as unknown as Prisma.InputJsonValue,
      },
    });

    this.metrics.incCooMonthlyDigestGenerated({ tenantTop });
    return this.toDto(row);
  }

  async markDelivered(args: { tenantId: string; periodYm: string }): Promise<void> {
    await this.prisma.monthlyOperationsDigest.update({
      where: { tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm } },
      data: { deliveredAt: new Date() },
    });
  }

  private async buildMonthPackage(args: {
    tenantId: string;
    periodYm: string;
    from: string;
    to: string;
  }): Promise<{
    pkg: MonthCompanyPackage;
    weeklyMetrics: WeeklyMetricsSlice[];
    weeklyDigestIds: string[];
  }> {
    const weekStarts = mondaysInMonth(args.periodYm);

    const weeks: MonthCompanyPackageWeek[] = [];
    const missingWeeks: string[] = [];
    const weeklyMetrics: WeeklyMetricsSlice[] = [];
    const weeklyDigestIds: string[] = [];
    try {
      const weekRows = await Promise.all(
        weekStarts.map((weekStart) =>
          this.prisma.weeklyOperationsDigest.findUnique({
            where: {
              tenantId_weekStart: { tenantId: args.tenantId, weekStart },
            },
            select: {
              id: true,
              weekStart: true,
              verdictJson: true,
              metricsJson: true,
            },
          }),
        ),
      );
      for (let i = 0; i < weekStarts.length; i++) {
        const weekStart = weekStarts[i]!;
        const row = weekRows[i];
        if (!row) {
          missingWeeks.push(weekStart);
          continue;
        }
        const parsed = parseWeekVerdict(row.verdictJson);
        weeks.push({
          weekStart,
          overallState: parsed.overallState,
          title: parsed.title,
          oneLiner: parsed.oneLiner,
          axes: parsed.axes,
        });
        weeklyMetrics.push(parseWeeklyMetrics(row.metricsJson));
        weeklyDigestIds.push(row.id);
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          periodYm: args.periodYm,
          err: err instanceof Error ? err.message : String(err),
        },
        'monthly-digest: сбор недельных снапшотов для пакета упал — деградирую без недель',
      );
    }

    let team: MonthCompanyPackage['team'] = {
      reliabilityPercent: null,
      tasksDone: 0,
      tasksPlanned: 0,
      tasksNotDone: 0,
      topRisk: [],
    };
    try {
      const pp = await this.perPerson.compute(
        {
          tenantId: args.tenantId,
          weekStart: args.from,
          weekEnd: args.to,
          limit: 100,
          offset: 0,
          sort: 'risk',
        },
        new Date(),
      );
      let tasksDone = 0;
      let tasksPlanned = 0;
      let tasksNotDone = 0;
      let kept = 0;
      let denom = 0;
      for (const r of pp.rows) {
        tasksDone += r.tasksDone;
        tasksPlanned += r.tasksPlanned;
        tasksNotDone += r.tasksNotDone;
        kept += r.promisesKept;
        denom += r.promisesKept + r.promisesBroken + r.promisesOverdue;
      }
      team = {
        reliabilityPercent: denom > 0 ? Math.round((kept / denom) * 100) : null,
        tasksDone,
        tasksPlanned,
        tasksNotDone,
        topRisk: pp.topRisk.slice(0, 3).map((r) => ({
          personName: r.personName,
          broken: r.promisesBroken,
          overdue: r.promisesOverdue,
        })),
      };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          periodYm: args.periodYm,
          err: err instanceof Error ? err.message : String(err),
        },
        'monthly-digest: сбор команды (per-person) для пакета упал — деградирую без команды',
      );
    }

    const repeatedBlockers = mergeBlockers(weeklyMetrics);

    let goalId: string | null = null;
    let goalName: string | null = null;
    let compass: MonthCompanyPackage['compass'] = null;
    let pace: MonthCompanyPackage['pace'] = null;
    try {
      const primaryGoal = await this.prisma.goal.findFirst({
        where: { tenantId: args.tenantId, isPrimary: true },
        select: { id: true, name: true, targetDate: true, createdAt: true },
      });
      const goal =
        primaryGoal ??
        (await this.prisma.goal.findFirst({
          where: { tenantId: args.tenantId, status: 'active' },
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
          select: { id: true, name: true, targetDate: true, createdAt: true },
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
        pace = this.computePace({
          score: compass.score,
          delta: compass.delta,
          to: monthBounds(args.periodYm).to,
          targetDate: goal.targetDate,
          createdAt: goal.createdAt,
        });
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          periodYm: args.periodYm,
          err: err instanceof Error ? err.message : String(err),
        },
        'monthly-digest: сбор компаса для пакета упал — деградирую без цели',
      );
      goalId = null;
      goalName = null;
      compass = null;
      pace = null;
    }

    let prevMonth: MonthCompanyPackage['prevMonth'] = null;
    try {
      const prev = await this.getStored({
        tenantId: args.tenantId,
        periodYm: shiftPeriod(args.periodYm, -1),
      });
      if (prev) {
        prevMonth = {
          state: prev.verdict?.overall.state ?? null,
          title: prev.verdict?.overall.title ?? null,
          shortSummary: prev.verdict?.overall.oneLiner ?? null,
        };
      }
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          periodYm: args.periodYm,
          err: err instanceof Error ? err.message : String(err),
        },
        'monthly-digest: снапшот прошлого месяца для пакета не получен — без петли',
      );
    }

    const pkg: MonthCompanyPackage = {
      periodYm: args.periodYm,
      from: args.from,
      to: args.to,
      goalId,
      goalName,
      weeks,
      team,
      repeatedBlockers,
      compass,
      pace,
      prevMonth,
      missingWeeks,
    };
    return { pkg, weeklyMetrics, weeklyDigestIds };
  }

  private computePace(args: {
    score: number | null;
    delta: number | null;
    to: Date;
    targetDate: Date | null;
    createdAt: Date;
  }): MonthCompanyPackage['pace'] {
    const factToGoal = args.score ?? null;

    let planToGoal: number | null = null;
    if (args.targetDate) {
      const total = args.targetDate.getTime() - args.createdAt.getTime();
      const elapsed = args.to.getTime() - args.createdAt.getTime();
      if (total > 0) {
        const ratio = elapsed / total;
        planToGoal = Math.max(0, Math.min(100, Math.round(ratio * 100)));
      }
    }

    let etaIso: string | null = null;
    if (args.score !== null && args.delta !== null && args.delta > 0) {
      const monthsLeft = Math.ceil((100 - args.score) / args.delta);
      const eta = new Date(
        Date.UTC(args.to.getUTCFullYear(), args.to.getUTCMonth() + monthsLeft + 1, 0, 23, 59, 59, 999),
      );
      etaIso = eta.toISOString();
    }

    return { factToGoal, planToGoal, etaIso };
  }

  private toDto(row: {
    id: string;
    tenantId: string;
    periodYm: string;
    bodyMarkdown: string;
    metricsJson: unknown;
    sourcesJson: unknown;
    llmTaskRouteId: string | null;
    createdAt: Date;
    shortSummary?: string | null;
    deliveredAt?: Date | null;
    verdictJson?: unknown;
    letterJson?: unknown;
    goalAlignmentMonthJson?: unknown;
    weekTrendJson?: unknown;
  }): MonthlyOperationsDigestDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      periodYm: row.periodYm,
      bodyMarkdown: row.bodyMarkdown,
      metrics: (row.metricsJson as MonthlyDigestMetricsDto) ?? emptyMetrics(),
      sources: (row.sourcesJson as MonthlyDigestSourcesDto) ?? emptySources(),
      llmTaskRouteId: row.llmTaskRouteId,
      createdAt: row.createdAt.toISOString(),
      shortSummary: row.shortSummary ?? null,
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      verdict: (row.verdictJson as MonthlyDigestVerdictDto | null) ?? null,
      letter: (row.letterJson as MonthlyDigestLetterSectionDto[] | null) ?? null,
      goalAlignmentMonth:
        (row.goalAlignmentMonthJson as MonthlyDigestGoalAlignmentMonthDto | null) ?? null,
      weekTrend: (row.weekTrendJson as MonthWeekTrendAxisDto[] | null) ?? null,
    };
  }
}
