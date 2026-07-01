import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type EntityLinkType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import type {
  CheckinDisciplineDto,
  CheckinDisciplinePersonDto,
  CheckinDisciplineTotalsDto,
} from '../dto/checkin-discipline.dto';
import type {
  InsightCauseCategoryAggregateDto,
  MaturitySnapshotDto,
  OperationsDashboardBlockerDto,
  OperationsDashboardBlockersListDto,
  OperationsDashboardCapacityDto,
  OperationsDashboardCapacityListDto,
  OperationsDashboardOverviewDto,
  OperationsDashboardTeamFrictionDto,
  OperationsDashboardTeamFrictionsListDto,
  OperationsInsightCauseCategory,
  OperationsMissingCheckInsDto,
  OperationsStaleIssuesDto,
  OperationsTeamTemperatureDto,
  OperationsTeamTemperaturePersonDto,
  OperationsTeamTemperatureSummaryDto,
} from '../dto/operations-dashboard.dto';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

const TEAM_FRICTION_RELATION_TYPES: EntityLinkType[] = ['conflicted_with'];
type Severity = 'low' | 'medium' | 'high' | 'unknown';

const INSIGHT_CAUSE_CATEGORIES: readonly OperationsInsightCauseCategory[] = [
  'process_gap',
  'tooling',
  'role_skill',
  'communication',
  'priority',
  'resource_constraint',
  'external',
  'unknown',
] as const;

function makeEmptyInsightCauseAggregate(): InsightCauseCategoryAggregateDto {
  return {
    process_gap: 0,
    tooling: 0,
    role_skill: 0,
    communication: 0,
    priority: 0,
    resource_constraint: 0,
    external: 0,
    unknown: 0,
  };
}

const WEEKLY_INFLOW_WEEKS = 12;
const WEEKLY_INFLOW_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function bucketizeWeeklyInflow(
  createdAts: Date[],
  now: Date,
  weeks: number = WEEKLY_INFLOW_WEEKS,
): Array<number | null> {
  const startMs = now.getTime() - weeks * WEEKLY_INFLOW_WEEK_MS;
  const nowMs = now.getTime();
  const counts = Array.from({ length: weeks }, () => 0);
  for (const d of createdAts) {
    const t = d.getTime();
    if (t < startMs || t >= nowMs) continue;
    const idx = Math.min(weeks - 1, Math.floor((t - startMs) / WEEKLY_INFLOW_WEEK_MS));
    const current = counts[idx];
    if (current === undefined) continue;
    counts[idx] = current + 1;
  }
  return counts.map((c) => (c === 0 ? null : c));
}

@Injectable()
export class OperationsDashboardService {
  private readonly logger = new Logger(OperationsDashboardService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(RedisService)
    private readonly redis?: RedisService,
  ) {}

  async getOverview(args: { tenantId: string }): Promise<OperationsDashboardOverviewDto> {
    const cacheKey = `ops_dashboard:${args.tenantId}:overview`;
    const cached = await this.cacheGet<OperationsDashboardOverviewDto>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * 24 * 3_600_000);

    const [
      blockers,
      goalsAgg,
      frictions,
      capacity,
      temperature,
      insightsByCauseCategory,
      maturity,
      blockersResolvedCount,
      frictionsResolvedCount,
      reworkEnabled,
      weeklyInflow,
    ] = await Promise.all([
      this.fetchBlockers(args.tenantId, 100),
      this.fetchGoalsAgg(args.tenantId),
      this.fetchTeamFrictions(args.tenantId, 100),
      this.fetchCapacity(args.tenantId),
      this.fetchTeamTemperature(args.tenantId, 7),
      this.fetchInsightsByCauseCategory(args.tenantId, 7),
      this.fetchMaturitySnapshot(args.tenantId),
      this.prisma.blockerSynthesis.count({
        where: {
          tenantId: args.tenantId,
          status: 'resolved',
          updatedAt: { gte: since30 },
        },
      }),
      this.prisma.entityLink.count({
        where: {
          tenantId: args.tenantId,
          relationType: 'conflicted_with',
          status: 'archived',
          updatedAt: { gte: since30 },
        },
      }),
      this.cfg.getDynamic<boolean>('operations.dashboard_rework.enabled', undefined, true),
      this.buildWeeklyInflow(args.tenantId, now),
    ]);

    const blockersBySeverity: Record<Severity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      unknown: 0,
    };
    for (const b of blockers) {
      blockersBySeverity[b.severity] += 1;
    }

    const teamTemperatureSummary: OperationsTeamTemperatureSummaryDto = {
      days: temperature.days,
      totalCheckIns: temperature.totalCheckIns,
      greenShare: temperature.greenShare,
      yellowShare: temperature.yellowShare,
      redShare: temperature.redShare,
      redShareDelta: temperature.redShareDelta,
    };

    const dto: OperationsDashboardOverviewDto = {
      tenantId: args.tenantId,
      generatedAt: new Date().toISOString(),
      blockersCount: blockers.length,
      blockersBySeverity,
      missedGoalsCount: goalsAgg.missed,
      cascadeMissedCount: goalsAgg.cascadeMissed,
      teamFrictionCount: frictions.length,
      blockersResolvedCount,
      frictionsResolvedCount,
      reworkEnabled,
      capacityAvgPercent: capacity.avgLoadPercent,
      capacityOverloadedCount: capacity.overloadedCount,
      topRecentBlockers: blockers.slice(0, 5),
      topRecentTeamFrictions: frictions.slice(0, 5),
      teamTemperature: teamTemperatureSummary,
      insightsByCauseCategory,
      maturity,
      weeklyInflow,
    };

    await this.cacheSet(cacheKey, dto);
    this.publishMetricsSnapshot(
      args.tenantId,
      blockersBySeverity,
      frictions.length,
      insightsByCauseCategory,
      maturity,
    );
    this.metrics.setCooTeamTemperatureRedShare({
      tenantTop: resolveOperationsTenantTop(args.tenantId),
      value: temperature.redShare,
    });
    this.metrics.setCooBlockersResolved({
      tenantTop: resolveOperationsTenantTop(args.tenantId),
      count: blockersResolvedCount,
    });
    return dto;
  }

  async getTeamTemperature(args: {
    tenantId: string;
    days: number;
  }): Promise<OperationsTeamTemperatureDto> {
    return this.fetchTeamTemperature(args.tenantId, args.days);
  }

  async getBlockers(args: {
    tenantId: string;
    limit?: number;
    window?: { from: string; to: string };
  }): Promise<OperationsDashboardBlockersListDto> {
    const limit = Math.min(args.limit ?? 50, 200);
    const items = await this.fetchBlockers(args.tenantId, limit, args.window);
    return { items, total: items.length };
  }

  async getTeamFrictions(args: {
    tenantId: string;
    limit?: number;
    since?: Date;
    to?: Date;
  }): Promise<OperationsDashboardTeamFrictionsListDto> {
    const limit = Math.min(args.limit ?? 50, 200);
    const items = await this.fetchTeamFrictions(args.tenantId, limit, args.since, args.to);
    return { items, total: items.length };
  }

  async getCapacity(args: { tenantId: string }): Promise<OperationsDashboardCapacityListDto> {
    return this.fetchCapacity(args.tenantId);
  }

  async getMissingCheckIns(args: {
    tenantId: string;
    date: string;
  }): Promise<OperationsMissingCheckInsDto> {
    const [persons, checkIns] = await Promise.all([
      this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          relationship: 'employee',
        },
        select: { id: true, name: true, primaryDepartmentId: true },
      }),
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          dateLocal: args.date,
        },
        select: { personId: true },
      }),
    ]);

    const respondedIds = new Set(checkIns.map((c) => c.personId));
    const missing = persons
      .filter((p) => !respondedIds.has(p.id))
      .map((p) => ({
        personId: p.id,
        personName: p.name,
        primaryDepartmentId: p.primaryDepartmentId,
      }));

    return {
      date: args.date,
      totalEmployees: persons.length,
      missing,
    };
  }

  async getCheckinDiscipline(args: {
    tenantId: string;
    from: string;
    to: string;
  }): Promise<CheckinDisciplineDto> {
    const enabled = this.cfg.betaOps.dailyCheckInEnabled;
    if (!enabled) {
      return {
        from: args.from,
        to: args.to,
        enabled: false,
        totals: emptyDisciplineTotals(),
        byPerson: [],
      };
    }

    const where = {
      tenantId: args.tenantId,
      dateLocal: { gte: args.from, lte: args.to },
    };

    const [expectedGroups, completedGroups] = await Promise.all([
      this.prisma.dailyCheckIn.groupBy({
        by: ['personId', 'kind'],
        where,
        _count: { _all: true },
      }),
      this.prisma.dailyCheckIn.groupBy({
        by: ['personId', 'kind'],
        where: { ...where, completedAt: { not: null } },
        _count: { _all: true },
      }),
    ]);

    type Acc = {
      morningExpected: number;
      morningCompleted: number;
      eveningExpected: number;
      eveningCompleted: number;
    };
    const byPersonAcc = new Map<string, Acc>();
    const ensure = (personId: string): Acc => {
      let acc = byPersonAcc.get(personId);
      if (!acc) {
        acc = {
          morningExpected: 0,
          morningCompleted: 0,
          eveningExpected: 0,
          eveningCompleted: 0,
        };
        byPersonAcc.set(personId, acc);
      }
      return acc;
    };

    for (const g of expectedGroups) {
      const acc = ensure(g.personId);
      const n = g._count._all;
      if (g.kind === 'morning') acc.morningExpected += n;
      else if (g.kind === 'evening') acc.eveningExpected += n;
    }
    for (const g of completedGroups) {
      const acc = ensure(g.personId);
      const n = g._count._all;
      if (g.kind === 'morning') acc.morningCompleted += n;
      else if (g.kind === 'evening') acc.eveningCompleted += n;
    }

    const personIds = [...byPersonAcc.keys()];
    const nameById = new Map<string, string>();
    if (personIds.length > 0) {
      const persons = await this.prisma.person.findMany({
        where: { tenantId: args.tenantId, id: { in: personIds } },
        select: { id: true, name: true },
      });
      for (const p of persons) nameById.set(p.id, p.name);
    }

    const byPerson: CheckinDisciplinePersonDto[] = [];
    const totals = emptyDisciplineTotals();
    for (const [personId, acc] of byPersonAcc) {
      const morningMissed = acc.morningExpected - acc.morningCompleted;
      const eveningMissed = acc.eveningExpected - acc.eveningCompleted;
      byPerson.push({
        personId,
        personName: nameById.get(personId) ?? 'Без имени',
        morningExpected: acc.morningExpected,
        morningCompleted: acc.morningCompleted,
        morningMissed,
        eveningExpected: acc.eveningExpected,
        eveningCompleted: acc.eveningCompleted,
        eveningMissed,
        completionRate: computeCompletionRate(
          acc.morningCompleted + acc.eveningCompleted,
          acc.morningExpected + acc.eveningExpected,
        ),
      });

      totals.morningExpected += acc.morningExpected;
      totals.morningCompleted += acc.morningCompleted;
      totals.morningMissed += morningMissed;
      totals.eveningExpected += acc.eveningExpected;
      totals.eveningCompleted += acc.eveningCompleted;
      totals.eveningMissed += eveningMissed;
    }
    totals.completionRate = computeCompletionRate(
      totals.morningCompleted + totals.eveningCompleted,
      totals.morningExpected + totals.eveningExpected,
    );

    byPerson.sort((a, b) => {
      const expA = a.morningExpected + a.eveningExpected;
      const expB = b.morningExpected + b.eveningExpected;
      if (expB !== expA) return expB - expA;
      return a.personName.localeCompare(b.personName, 'ru');
    });

    return {
      from: args.from,
      to: args.to,
      enabled: true,
      totals,
      byPerson,
    };
  }

  async getStaleIssues(args: {
    tenantId: string;
    staleDays?: number;
    limit?: number;
  }): Promise<OperationsStaleIssuesDto> {
    const staleDays = Math.max(1, args.staleDays ?? 5);
    const limit = Math.min(Math.max(1, args.limit ?? 20), 100);
    const now = new Date();
    const staleThreshold = new Date(now.getTime() - staleDays * 24 * 60 * 60 * 1000);

    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        archivedAt: null,
        completedAt: null,
        OR: [{ updatedAt: { lt: staleThreshold } }, { dueDate: { lt: now } }],
      },
      select: {
        id: true,
        title: true,
        identifier: true,
        updatedAt: true,
        dueDate: true,
        assignees: { select: { userId: true } },
      },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });

    const dayMs = 24 * 60 * 60 * 1000;
    return {
      items: issues.map((i) => ({
        issueId: i.id,
        title: i.title,
        identifier: i.identifier,
        daysSinceActivity: Math.floor((now.getTime() - i.updatedAt.getTime()) / dayMs),
        daysOverdue:
          i.dueDate && i.dueDate.getTime() < now.getTime()
            ? Math.floor((now.getTime() - i.dueDate.getTime()) / dayMs)
            : null,
        assigneeUserIds: i.assignees.map((a) => a.userId),
      })),
    };
  }

  async invalidateCache(tenantId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await Promise.all([this.redis.client.del(`ops_dashboard:${tenantId}:overview`)]);
    } catch (err) {
      this.logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'OperationsDashboardService.invalidateCache: ignore error',
      );
    }
  }

  private async fetchBlockers(
    tenantId: string,
    limit: number,
    window?: { from: string; to: string },
  ): Promise<OperationsDashboardBlockerDto[]> {
    let dateFilter: Prisma.DailyCheckInWhereInput;
    if (window) {
      dateFilter = { dateLocal: { gte: window.from, lte: window.to } };
    } else {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - 7);
      dateFilter = { createdAt: { gte: since } };
    }
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId,
        ...dateFilter,
        blockersJson: { not: Prisma.JsonNull },
      },
      select: {
        id: true,
        personId: true,
        person: { select: { name: true } },
        blockersJson: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const out: OperationsDashboardBlockerDto[] = [];
    for (const row of checkIns) {
      if (!Array.isArray(row.blockersJson)) continue;
      for (const b of row.blockersJson as Array<{
        text?: string;
        severity?: string;
        ownerHint?: string;
        sourceBlockId?: string;
      }>) {
        if (!b || typeof b.text !== 'string') continue;
        const severity = normalizeSeverity(b.severity);
        out.push({
          id: `${row.id}:${out.length}`,
          text: b.text.slice(0, 4_000),
          severity,
          ownerHint: typeof b.ownerHint === 'string' ? b.ownerHint : null,
          ownerPersonId: row.personId,
          ownerPersonName: row.person?.name ?? null,
          createdAt: row.createdAt.toISOString(),
          sourceBlockId: typeof b.sourceBlockId === 'string' ? b.sourceBlockId : null,
          sourceCheckInId: row.id,
        });
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }

    return out;
  }

  private async fetchGoalsAgg(
    tenantId: string,
  ): Promise<{ missed: number; cascadeMissed: number }> {
    const [missed, cascadeMissed] = await Promise.all([
      this.prisma.goal.count({
        where: {
          tenantId,
          status: 'abandoned',
          archivedAt: null,
        },
      }),
      this.prisma.goal.count({
        where: {
          tenantId,
          cascadeMissed: true,
          archivedAt: null,
        },
      }),
    ]);
    return { missed, cascadeMissed };
  }

  private async fetchTeamFrictions(
    tenantId: string,
    limit: number,
    since?: Date,
    to?: Date,
  ): Promise<OperationsDashboardTeamFrictionDto[]> {
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        relationType: { in: TEAM_FRICTION_RELATION_TYPES },
        status: 'active',
        deletedAt: null,
        ...(since || to
          ? {
              createdAt: {
                ...(since ? { gte: since } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        fromEntityId: true,
        toEntityId: true,
        relationType: true,
        confidence: true,
        explanation: true,
        createdAt: true,
        validFrom: true,
      },
    });
    if (links.length === 0) return [];

    const entityIds = new Set<string>();
    for (const l of links) {
      entityIds.add(l.fromEntityId);
      entityIds.add(l.toEntityId);
    }
    const persons = await this.prisma.person.findMany({
      where: {
        tenantId,
        entityId: { in: Array.from(entityIds) },
      },
      select: { id: true, entityId: true, name: true },
    });
    const byEntity = new Map<string, { id: string; name: string }>();
    for (const p of persons) {
      if (p.entityId) byEntity.set(p.entityId, { id: p.id, name: p.name });
    }

    return links.map((l) => {
      const from = byEntity.get(l.fromEntityId);
      const to = byEntity.get(l.toEntityId);
      return {
        id: l.id,
        fromPersonId: from?.id ?? l.fromEntityId,
        fromPersonName: from?.name ?? null,
        toPersonId: to?.id ?? l.toEntityId,
        toPersonName: to?.name ?? null,
        relationType: l.relationType,
        confidence: Number(l.confidence.toString()),
        explanation: l.explanation,
        observedAt: l.validFrom.toISOString(),
      };
    });
  }

  private async fetchTeamTemperature(
    tenantId: string,
    days: number,
  ): Promise<OperationsTeamTemperatureDto> {
    const sinceCurrent = isoDateDaysAgo(days);
    const sincePrev = isoDateDaysAgo(days * 2);

    const rows = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId,
        sentiment: { in: ['green', 'yellow', 'red'] },
        dateLocal: { gte: sincePrev },
      },
      select: {
        sentiment: true,
        dateLocal: true,
        personId: true,
        person: { select: { name: true } },
      },
    });

    let currG = 0;
    let currY = 0;
    let currR = 0;
    let prevG = 0;
    let prevY = 0;
    let prevR = 0;
    const byPersonMap = new Map<string, OperationsTeamTemperaturePersonDto>();

    for (const row of rows) {
      const isCurrent = row.dateLocal >= sinceCurrent;
      const sentiment = row.sentiment;
      if (sentiment === 'green') {
        if (isCurrent) currG++;
        else prevG++;
      } else if (sentiment === 'yellow') {
        if (isCurrent) currY++;
        else prevY++;
      } else if (sentiment === 'red') {
        if (isCurrent) currR++;
        else prevR++;
      }

      if (isCurrent) {
        const existing = byPersonMap.get(row.personId);
        if (existing) {
          if (sentiment === 'green') existing.green++;
          else if (sentiment === 'yellow') existing.yellow++;
          else if (sentiment === 'red') existing.red++;
          existing.total++;
        } else {
          byPersonMap.set(row.personId, {
            personId: row.personId,
            personName: row.person?.name ?? null,
            green: sentiment === 'green' ? 1 : 0,
            yellow: sentiment === 'yellow' ? 1 : 0,
            red: sentiment === 'red' ? 1 : 0,
            total: 1,
          });
        }
      }
    }

    const currTotal = currG + currY + currR;
    const prevTotal = prevG + prevY + prevR;
    const greenShare = currTotal > 0 ? currG / currTotal : 0;
    const yellowShare = currTotal > 0 ? currY / currTotal : 0;
    const redShare = currTotal > 0 ? currR / currTotal : 0;
    const redShareDelta = prevTotal > 0 ? redShare - prevR / prevTotal : null;

    const byPerson = Array.from(byPersonMap.values()).sort(
      (a, b) => b.red - a.red || b.total - a.total,
    );

    return {
      days,
      totalCheckIns: currTotal,
      greenShare,
      yellowShare,
      redShare,
      redShareDelta,
      byPerson,
    };
  }

  private async fetchInsightsByCauseCategory(
    tenantId: string,
    days = 7,
  ): Promise<InsightCauseCategoryAggregateDto> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    const grouped = await this.prisma.insight.groupBy({
      by: ['causeCategory'],
      where: {
        tenantId,
        severity: { in: ['medium', 'high'] },
        status: { not: 'archived' },
        firstObservedAt: { gte: since },
      },
      _count: { _all: true },
    });

    const out = makeEmptyInsightCauseAggregate();
    const whitelist = new Set<string>(INSIGHT_CAUSE_CATEGORIES);
    for (const row of grouped) {
      const cause: OperationsInsightCauseCategory =
        row.causeCategory && whitelist.has(row.causeCategory)
          ? (row.causeCategory as OperationsInsightCauseCategory)
          : 'unknown';
      out[cause] += row._count._all;
    }
    return out;
  }

  private async fetchMaturitySnapshot(tenantId: string): Promise<MaturitySnapshotDto> {
    const [profile, domains] = await Promise.all([
      this.prisma.companyProfile.findUnique({
        where: { tenantId },
        select: {
          maturityScore: true,
          lastMaturityCalcAt: true,
          stage: true,
        },
      }),
      this.prisma.functionalDomain.findMany({
        where: {
          tenantId,
          deletedAt: null,
          completeness: { not: null },
        },
        select: { slug: true, name: true, completeness: true },
      }),
    ]);

    const normalized = domains
      .map((d) => ({
        slug: d.slug,
        name: d.name,
        completeness: d.completeness === null ? null : Number(d.completeness.toString()),
      }))
      .filter(
        (d): d is { slug: string; name: string; completeness: number } =>
          d.completeness !== null && Number.isFinite(d.completeness),
      );

    const byAsc = [...normalized].sort((a, b) => a.completeness - b.completeness);
    const byDesc = [...normalized].sort((a, b) => b.completeness - a.completeness);

    return {
      score:
        profile?.maturityScore !== null && profile?.maturityScore !== undefined
          ? Number(profile.maturityScore.toString())
          : null,
      lastCalcAt: profile?.lastMaturityCalcAt ? profile.lastMaturityCalcAt.toISOString() : null,
      stage: profile?.stage ?? null,
      weakestDomains: byAsc.slice(0, 3),
      topDomains: byDesc.slice(0, 3),
    };
  }

  private async buildWeeklyInflow(
    tenantId: string,
    now: Date,
  ): Promise<{ blockers: Array<number | null>; frictions: Array<number | null> }> {
    const start = new Date(now.getTime() - WEEKLY_INFLOW_WEEKS * WEEKLY_INFLOW_WEEK_MS);
    const [blockerRows, frictionRows] = await Promise.all([
      this.prisma.blockerSynthesis.findMany({
        where: { tenantId, createdAt: { gte: start, lt: now } },
        select: { createdAt: true },
      }),
      this.prisma.entityLink.findMany({
        where: {
          tenantId,
          relationType: 'conflicted_with',
          createdAt: { gte: start, lt: now },
        },
        select: { createdAt: true },
      }),
    ]);
    return {
      blockers: bucketizeWeeklyInflow(
        blockerRows.map((r) => r.createdAt),
        now,
      ),
      frictions: bucketizeWeeklyInflow(
        frictionRows.map((r) => r.createdAt),
        now,
      ),
    };
  }

  private async fetchCapacity(tenantId: string): Promise<OperationsDashboardCapacityListDto> {
    const appts = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        status: 'active',
        validTo: null,
      },
      select: {
        personId: true,
        loadPercent: true,
        person: { select: { id: true, name: true } },
      },
    });

    const byPerson = new Map<string, OperationsDashboardCapacityDto>();
    for (const a of appts) {
      if (!a.person) continue;
      const existing = byPerson.get(a.personId);
      if (existing) {
        existing.loadPercent += a.loadPercent;
        existing.appointmentsCount += 1;
      } else {
        byPerson.set(a.personId, {
          personId: a.person.id,
          personName: a.person.name,
          loadPercent: a.loadPercent,
          appointmentsCount: 1,
        });
      }
    }

    const items = Array.from(byPerson.values()).sort((a, b) => b.loadPercent - a.loadPercent);

    const overloadedCount = items.filter((it) => it.loadPercent > 100).length;
    const avgLoadPercent =
      items.length === 0
        ? 0
        : Math.round(items.reduce((acc, it) => acc + it.loadPercent, 0) / items.length);

    return { items, avgLoadPercent, overloadedCount };
  }

  private publishMetricsSnapshot(
    tenantId: string,
    bySeverity: Record<Severity, number>,
    frictionCount: number,
    insightsByCauseCategory: InsightCauseCategoryAggregateDto,
    maturity: MaturitySnapshotDto,
  ): void {
    const tenantTop = resolveOperationsTenantTop(tenantId);
    for (const sev of Object.keys(bySeverity) as Severity[]) {
      this.metrics.setOperationsBlockersTotal({
        tenantTop,
        severity: sev,
        value: bySeverity[sev],
      });
    }
    this.metrics.setTeamFrictionsTotal({
      tenantTop,
      value: frictionCount,
    });
    for (const cause of INSIGHT_CAUSE_CATEGORIES) {
      this.metrics.setCooInsightsByCause({
        tenantTop,
        cause,
        value: insightsByCauseCategory[cause] ?? 0,
      });
    }
    if (maturity.score !== null) {
      this.metrics.setCooCompanyMaturityScore({
        tenantTop,
        value: maturity.score,
      });
    }
  }

  private async cacheGet<T>(key: string): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.debug(
        { key, err: err instanceof Error ? err.message : String(err) },
        'OperationsDashboardService.cacheGet error',
      );
      return null;
    }
  }

  private async cacheSet(key: string, value: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      const ttl = this.cfg.betaOps.operationsDashboardCacheTtlSeconds;
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      this.logger.debug(
        { key, err: err instanceof Error ? err.message : String(err) },
        'OperationsDashboardService.cacheSet error',
      );
    }
  }
}

function normalizeSeverity(value: string | undefined): Severity {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'unknown';
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function emptyDisciplineTotals(): CheckinDisciplineTotalsDto {
  return {
    morningExpected: 0,
    morningCompleted: 0,
    morningMissed: 0,
    eveningExpected: 0,
    eveningCompleted: 0,
    eveningMissed: 0,
    completionRate: null,
  };
}

function computeCompletionRate(completed: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.round((completed / expected) * 1000) / 1000;
}
