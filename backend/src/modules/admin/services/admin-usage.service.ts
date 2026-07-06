import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { AdminPeriod } from '../dto/admin-usage.dto';

import { AdminCacheService } from './admin-cache.service';

export type AdminScope = 'global' | 'org';

interface ScopeArgs {
  scope: AdminScope;
  tenantId?: string;
}

interface PeriodArgs {
  period: AdminPeriod;
  from?: Date;
  to?: Date;
}

interface DashboardFilterArgs {
  provider?: string;
  model?: string;
  taskType?: string;
  orgId?: string;
}

const DASHBOARD_TTL_MS = 60_000;

interface UsageCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(c: UsageCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf-8').toString('base64');
}

function decodeCursor(raw: string | undefined): UsageCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).createdAt === 'string' &&
      typeof (parsed as Record<string, unknown>).id === 'string'
    ) {
      return parsed as UsageCursor;
    }
    return null;
  } catch {
    return null;
  }
}

export function periodToRange(p: PeriodArgs): { gte: Date; lt: Date } {
  const now = new Date();
  if (p.period === 'custom') {
    if (!p.from || !p.to) throw new Error('period=custom requires from/to');
    return { gte: p.from, lt: p.to };
  }
  const lt = now;
  const gte = new Date(now);
  if (p.period === 'day') gte.setUTCDate(gte.getUTCDate() - 1);
  else if (p.period === 'week') gte.setUTCDate(gte.getUTCDate() - 7);
  else if (p.period === 'month') gte.setUTCMonth(gte.getUTCMonth() - 1);
  return { gte, lt };
}

function decimalToNumber(v: Prisma.Decimal | null | undefined): number {
  if (v === null || v === undefined) return 0;
  if (typeof (v as unknown as { toNumber?: () => number }).toNumber === 'function') {
    try {
      return (v as unknown as { toNumber: () => number }).toNumber();
    } catch {
      return 0;
    }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export interface AdminDashboardResult {
  scope: AdminScope;
  tenantId: string | null;
  period: { from: string; to: string; kind: AdminPeriod };
  totals: {
    totalCostUsd: number;
    totalCalls: number;
    failedCalls: number;
  };
  byProvider: Array<{ provider: string; costUsd: number; calls: number }>;
  byModel: Array<{ provider: string; model: string; costUsd: number; calls: number }>;
  byTaskType: Array<{ taskType: string; costUsd: number; calls: number }>;
  topOrgs?: Array<{ tenantId: string; name: string; costUsd: number; calls: number }>;
  trend: Array<{ date: string; costUsd: number; calls: number; failedCalls: number }>;
  counts?: {
    orgsTotal: number;
    usersTotal: number;
    activeUsers7d: number;
  };
}

export interface AdminCallLogItem {
  id: string;
  createdAt: string;
  tenantId: string | null;
  taskType: string | null;
  userId: string | null;
  userEmail: string | null;
  meetingId: string | null;
  meetingTitle: string | null;
  agentType: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  durationMs: number;
  success: boolean;
  errorText: string | null;
  experimentGroup: string | null;
  sourceRef: { type: string; id: string } | null;
}

export interface AdminCallDetail extends AdminCallLogItem {
  requestPreview: string | null;
  responsePreview: string | null;
}

@Injectable()
export class AdminUsageService {
  private readonly logger = new Logger(AdminUsageService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
  ) {}

  private buildTenantWhere(args: ScopeArgs): { tenantId?: string } {
    if (args.scope === 'org') {
      if (!args.tenantId) {
        throw new Error('AdminUsageService: scope=org требует tenantId');
      }
      return { tenantId: args.tenantId };
    }
    return {};
  }

  private cacheKey(args: ScopeArgs & PeriodArgs & DashboardFilterArgs, kind: string): string {
    const tenant = args.scope === 'org' ? (args.tenantId ?? '*') : '*';
    const periodKey =
      args.period === 'custom'
        ? `custom_${args.from?.toISOString()}_${args.to?.toISOString()}`
        : args.period;
    const filterKey = `${args.provider ?? '*'}:${args.model ?? '*'}:${args.taskType ?? '*'}:${args.orgId ?? '*'}`;
    return `usage:${kind}:${args.scope}:${tenant}:${periodKey}:${filterKey}`;
  }

  async getDashboard(
    args: ScopeArgs & PeriodArgs & DashboardFilterArgs,
  ): Promise<AdminDashboardResult> {
    const cacheKey = this.cacheKey(args, 'dashboard');
    const cached = this.cache.get<AdminDashboardResult>(cacheKey);
    if (cached) return cached;

    const range = periodToRange(args);
    const tenantWhere = this.buildTenantWhere(args);
    const baseWhere: Prisma.AiUsageLogWhereInput = {
      createdAt: { gte: range.gte, lt: range.lt },
      ...tenantWhere,
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.taskType ? { taskType: args.taskType } : {}),
      ...(args.scope === 'global' && args.orgId ? { tenantId: args.orgId } : {}),
    };

    const [totalsAgg, failedAgg, byProvider, byModel, byTaskType, counts, topOrgs, trend] =
      await Promise.all([
        this.prisma.aiUsageLog.aggregate({
          where: baseWhere,
          _sum: { costUsd: true },
          _count: { _all: true },
        }),
        this.prisma.aiUsageLog.count({
          where: { ...baseWhere, success: false },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ['provider'],
          where: baseWhere,
          _sum: { costUsd: true },
          _count: { _all: true },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ['provider', 'model'],
          where: baseWhere,
          _sum: { costUsd: true },
          _count: { _all: true },
        }),
        this.prisma.aiUsageLog.groupBy({
          by: ['taskType'],
          where: baseWhere,
          _sum: { costUsd: true },
          _count: { _all: true },
        }),
        args.scope === 'global' ? this.fetchGlobalCounts() : Promise.resolve(undefined),
        args.scope === 'global'
          ? this.fetchTopOrgsByCost(range, 10, args)
          : Promise.resolve(undefined),
        this.fetchDailyTrend(range, baseWhere),
      ]);

    const result: AdminDashboardResult = {
      scope: args.scope,
      tenantId: args.scope === 'org' ? (args.tenantId ?? null) : null,
      period: {
        from: range.gte.toISOString(),
        to: range.lt.toISOString(),
        kind: args.period,
      },
      totals: {
        totalCostUsd: decimalToNumber(totalsAgg._sum.costUsd),
        totalCalls: totalsAgg._count._all,
        failedCalls: failedAgg,
      },
      byProvider: byProvider
        .map((r) => ({
          provider: r.provider,
          costUsd: decimalToNumber(r._sum.costUsd),
          calls: r._count._all,
        }))
        .sort((a, b) => b.costUsd - a.costUsd),
      byModel: byModel
        .map((r) => ({
          provider: r.provider,
          model: r.model,
          costUsd: decimalToNumber(r._sum.costUsd),
          calls: r._count._all,
        }))
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 20),
      byTaskType: byTaskType
        .map((r) => ({
          taskType: r.taskType ?? 'unknown',
          costUsd: decimalToNumber(r._sum.costUsd),
          calls: r._count._all,
        }))
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 20),
      trend,
      ...(counts !== undefined ? { counts } : {}),
      ...(topOrgs !== undefined ? { topOrgs } : {}),
    };

    this.cache.setWithTtl(cacheKey, result, DASHBOARD_TTL_MS);
    return result;
  }

  private async fetchDailyTrend(
    range: { gte: Date; lt: Date },
    where: Prisma.AiUsageLogWhereInput,
  ): Promise<Array<{ date: string; costUsd: number; calls: number; failedCalls: number }>> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"createdAt" >= ${range.gte}`,
      Prisma.sql`"createdAt" < ${range.lt}`,
    ];
    if (typeof where.tenantId === 'string') {
      conditions.push(Prisma.sql`"tenantId" = ${where.tenantId}`);
    }
    if (typeof where.provider === 'string') {
      conditions.push(Prisma.sql`"provider" = ${where.provider}`);
    }
    if (typeof where.model === 'string') {
      conditions.push(Prisma.sql`"model" = ${where.model}`);
    }
    if (typeof where.taskType === 'string') {
      conditions.push(Prisma.sql`"taskType" = ${where.taskType}`);
    }

    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; cost: number; calls: bigint; failed: bigint }>
    >(Prisma.sql`
      SELECT
        date_trunc('day', "createdAt") AS day,
        COALESCE(SUM("costUsd"), 0)::float8 AS cost,
        COUNT(*) AS calls,
        COUNT(*) FILTER (WHERE "success" = false) AS failed
      FROM "AiUsageLog"
      WHERE ${Prisma.join(conditions, ' AND ')}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      costUsd: r.cost,
      calls: Number(r.calls),
      failedCalls: Number(r.failed),
    }));
  }

  private async fetchGlobalCounts(): Promise<{
    orgsTotal: number;
    usersTotal: number;
    activeUsers7d: number;
  }> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [orgsTotal, usersTotal, activeUsers7d] = await Promise.all([
      this.prisma.org.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          lastSeenAt: { gte: sevenDaysAgo },
        },
      }),
    ]);
    return { orgsTotal, usersTotal, activeUsers7d };
  }

  private async fetchTopOrgsByCost(
    range: { gte: Date; lt: Date },
    limit: number,
    filters: DashboardFilterArgs = {},
  ): Promise<Array<{ tenantId: string; name: string; costUsd: number; calls: number }>> {
    const rows = await this.prisma.aiUsageLog.groupBy({
      by: ['tenantId'],
      where: {
        createdAt: { gte: range.gte, lt: range.lt },
        tenantId: filters.orgId ? filters.orgId : { not: null },
        ...(filters.provider ? { provider: filters.provider } : {}),
        ...(filters.model ? { model: filters.model } : {}),
        ...(filters.taskType ? { taskType: filters.taskType } : {}),
      },
      _sum: { costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { costUsd: 'desc' } },
      take: limit,
    });
    const tenantIds = rows.map((r) => r.tenantId).filter((x): x is string => x !== null);
    if (tenantIds.length === 0) return [];
    const orgs = await this.prisma.org.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(orgs.map((o) => [o.id, o.name]));
    return rows
      .filter((r): r is typeof r & { tenantId: string } => r.tenantId !== null)
      .map((r) => ({
        tenantId: r.tenantId,
        name: nameById.get(r.tenantId) ?? '(deleted)',
        costUsd: decimalToNumber(r._sum.costUsd),
        calls: r._count._all,
      }));
  }

  async getCallsLog(
    args: ScopeArgs & {
      taskType?: string;
      userId?: string;
      meetingId?: string;
      experimentGroup?: 'A' | 'B';
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: AdminCallLogItem[]; nextCursor: string | null }> {
    const tenantWhere = this.buildTenantWhere(args);
    const where: Prisma.AiUsageLogWhereInput = { ...tenantWhere };
    if (args.taskType) where.taskType = args.taskType;
    if (args.userId) where.userId = args.userId;
    if (args.meetingId) where.meetingId = args.meetingId;
    if (args.experimentGroup) where.experimentGroup = args.experimentGroup;

    const cursor = decodeCursor(args.cursor);
    if (cursor) {
      const cursorDate = new Date(cursor.createdAt);
      where.OR = [
        { createdAt: { lt: cursorDate } },
        { AND: [{ createdAt: cursorDate }, { id: { lt: cursor.id } }] },
      ];
    }

    const rows = await this.prisma.aiUsageLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: args.limit + 1,
    });

    const meetingIds = Array.from(
      new Set(rows.map((r) => r.meetingId).filter((x): x is string => x !== null)),
    );
    const userIds = Array.from(
      new Set(rows.map((r) => r.userId).filter((x): x is string => x !== null)),
    );

    const [meetings, users] = await Promise.all([
      meetingIds.length > 0
        ? this.prisma.meeting.findMany({
            where: { id: { in: meetingIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      userIds.length > 0
        ? this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, email: true },
          })
        : Promise.resolve([]),
    ]);
    const meetingTitleById = new Map(meetings.map((m) => [m.id, m.title]));
    const userEmailById = new Map(users.map((u) => [u.id, u.email]));

    const items: AdminCallLogItem[] = rows.slice(0, args.limit).map((r) =>
      this.toCallLogItem(r, {
        meetingTitle: r.meetingId ? (meetingTitleById.get(r.meetingId) ?? null) : null,
        userEmail: r.userId ? (userEmailById.get(r.userId) ?? null) : null,
      }),
    );

    const hasMore = rows.length > args.limit;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null;
    return { items, nextCursor };
  }

  async getCallDetails(args: ScopeArgs & { callId: string }): Promise<AdminCallDetail | null> {
    const tenantWhere = this.buildTenantWhere(args);
    const row = await this.prisma.aiUsageLog.findFirst({
      where: { id: args.callId, ...tenantWhere },
    });
    if (!row) return null;

    let meetingTitle: string | null = null;
    let userEmail: string | null = null;
    if (row.meetingId) {
      const m = await this.prisma.meeting.findUnique({
        where: { id: row.meetingId },
        select: { title: true },
      });
      meetingTitle = m?.title ?? null;
    }
    if (row.userId) {
      const u = await this.prisma.user.findUnique({
        where: { id: row.userId },
        select: { email: true },
      });
      userEmail = u?.email ?? null;
    }

    return {
      ...this.toCallLogItem(row, { meetingTitle, userEmail }),
      requestPreview: row.requestPreview,
      responsePreview: row.responsePreview,
    };
  }

  async getFunctionCalls(
    args: ScopeArgs & { taskType: string; limit: number; experimentGroup?: 'A' | 'B' },
  ): Promise<{ items: AdminCallLogItem[] }> {
    const result = await this.getCallsLog({
      scope: args.scope,
      ...(args.tenantId !== undefined ? { tenantId: args.tenantId } : {}),
      taskType: args.taskType,
      limit: args.limit,
      ...(args.experimentGroup ? { experimentGroup: args.experimentGroup } : {}),
    });
    return { items: result.items };
  }

  private toCallLogItem(
    r: {
      id: string;
      createdAt: Date;
      tenantId: string | null;
      taskType: string | null;
      userId: string | null;
      meetingId: string | null;
      agentType: string;
      model: string;
      provider: string;
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      costUsd: Prisma.Decimal;
      durationMs: number;
      success: boolean;
      errorText: string | null;
      experimentGroup: string | null;
      sourceRef: Prisma.JsonValue;
    },
    ctx: { meetingTitle: string | null; userEmail: string | null },
  ): AdminCallLogItem {
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      tenantId: r.tenantId,
      taskType: r.taskType,
      userId: r.userId,
      userEmail: ctx.userEmail,
      meetingId: r.meetingId,
      meetingTitle: ctx.meetingTitle,
      agentType: r.agentType,
      model: r.model,
      provider: r.provider,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cachedTokens: r.cachedTokens,
      costUsd: decimalToNumber(r.costUsd),
      durationMs: r.durationMs,
      success: r.success,
      errorText: r.errorText,
      experimentGroup: r.experimentGroup,
      sourceRef: parseSourceRef(r.sourceRef),
    };
  }
}

function parseSourceRef(raw: Prisma.JsonValue): { type: string; id: string } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const t = (raw as Record<string, unknown>).type;
  const i = (raw as Record<string, unknown>).id;
  if (typeof t === 'string' && typeof i === 'string') {
    return { type: t, id: i };
  }
  return null;
}
