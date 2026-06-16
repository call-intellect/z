import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ALL_LLM_TASK_TYPES } from '../../ai/services/llm-router.service';
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
  byTaskType: Array<{ taskType: string; costUsd: number; calls: number }>;
  topOrgs?: Array<{ tenantId: string; name: string; costUsd: number; calls: number }>;
  counts?: {
    orgsTotal: number;
    usersTotal: number;
    activeUsers7d: number;
  };
}

export interface AdminUsersUsageRow {
  userId: string;
  userEmail: string;
  userName: string;
  tenantId: string | null;
  tenantName: string | null;
  totalCostUsd: number;
  totalCalls: number;
  byTaskType: Array<{ taskType: string; costUsd: number; calls: number }>;
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

export interface AdminFunctionUsageRow {
  taskType: string;
  hasRoute: boolean;
  isActive: boolean;
  experimentEnabled: boolean;
  currentProvider: string | null;
  fallbackChain: string[];
  totalCalls: number;
  failedCalls: number;
  failRate: number;
  avgCostUsd: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  totalCostUsd: number;
}

export interface AdminUsageScopeAccessError extends Error {
  code: 'admin_scope_invalid';
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

  private cacheKey(args: ScopeArgs & PeriodArgs, kind: string): string {
    const tenant = args.scope === 'org' ? (args.tenantId ?? '*') : '*';
    const periodKey =
      args.period === 'custom'
        ? `custom_${args.from?.toISOString()}_${args.to?.toISOString()}`
        : args.period;
    return `usage:${kind}:${args.scope}:${tenant}:${periodKey}`;
  }

  async getDashboard(args: ScopeArgs & PeriodArgs): Promise<AdminDashboardResult> {
    const cacheKey = this.cacheKey(args, 'dashboard');
    const cached = this.cache.get<AdminDashboardResult>(cacheKey);
    if (cached) return cached;

    const range = periodToRange(args);
    const tenantWhere = this.buildTenantWhere(args);
    const baseWhere: Prisma.AiUsageLogWhereInput = {
      createdAt: { gte: range.gte, lt: range.lt },
      ...tenantWhere,
    };

    const [totalsAgg, failedAgg, byProvider, byTaskType, counts, topOrgs] = await Promise.all([
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
        by: ['taskType'],
        where: baseWhere,
        _sum: { costUsd: true },
        _count: { _all: true },
      }),
      args.scope === 'global' ? this.fetchGlobalCounts() : Promise.resolve(undefined),
      args.scope === 'global' ? this.fetchTopOrgsByCost(range, 10) : Promise.resolve(undefined),
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
      byTaskType: byTaskType
        .map((r) => ({
          taskType: r.taskType ?? 'unknown',
          costUsd: decimalToNumber(r._sum.costUsd),
          calls: r._count._all,
        }))
        .sort((a, b) => b.costUsd - a.costUsd)
        .slice(0, 20),
      ...(counts !== undefined ? { counts } : {}),
      ...(topOrgs !== undefined ? { topOrgs } : {}),
    };

    this.cache.setWithTtl(cacheKey, result, DASHBOARD_TTL_MS);
    return result;
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
  ): Promise<Array<{ tenantId: string; name: string; costUsd: number; calls: number }>> {
    const rows = await this.prisma.aiUsageLog.groupBy({
      by: ['tenantId'],
      where: { createdAt: { gte: range.gte, lt: range.lt }, tenantId: { not: null } },
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

  async getUsersUsage(
    args: ScopeArgs & PeriodArgs & { limit: number; cursor?: string; search?: string },
  ): Promise<{ items: AdminUsersUsageRow[]; nextCursor: string | null }> {
    const range = periodToRange(args);
    const tenantWhere = this.buildTenantWhere(args);
    const baseWhere: Prisma.AiUsageLogWhereInput = {
      createdAt: { gte: range.gte, lt: range.lt },
      userId: { not: null },
      ...tenantWhere,
    };

    const grouped = await this.prisma.aiUsageLog.groupBy({
      by: ['userId'],
      where: baseWhere,
      _sum: { costUsd: true },
      _count: { _all: true },
      orderBy: { _sum: { costUsd: 'desc' } },
      take: args.limit + 1,
    });

    const userIds = grouped.map((r) => r.userId).filter((x): x is string => x !== null);
    if (userIds.length === 0) {
      return { items: [], nextCursor: null };
    }

    const usersFilter: Prisma.UserWhereInput = { id: { in: userIds } };
    if (args.search) {
      usersFilter.OR = [
        { email: { contains: args.search, mode: 'insensitive' } },
        { name: { contains: args.search, mode: 'insensitive' } },
      ];
    }
    const users = await this.prisma.user.findMany({
      where: usersFilter,
      select: { id: true, email: true, name: true },
    });
    const usersById = new Map(users.map((u) => [u.id, u]));

    const breakdownRows = await this.prisma.aiUsageLog.groupBy({
      by: ['userId', 'taskType'],
      where: { ...baseWhere, userId: { in: userIds } },
      _sum: { costUsd: true },
      _count: { _all: true },
    });
    const breakdownByUser = new Map<
      string,
      Array<{ taskType: string; costUsd: number; calls: number }>
    >();
    for (const r of breakdownRows) {
      if (!r.userId) continue;
      const existing = breakdownByUser.get(r.userId) ?? [];
      existing.push({
        taskType: r.taskType ?? 'unknown',
        costUsd: decimalToNumber(r._sum.costUsd),
        calls: r._count._all,
      });
      breakdownByUser.set(r.userId, existing);
    }

    const tenantNamesByUser = new Map<string, { id: string; name: string }>();
    if (args.scope === 'global') {
      const memberships = await this.prisma.membership.findMany({
        where: { userId: { in: userIds } },
        select: {
          userId: true,
          orgId: true,
          org: { select: { name: true } },
        },
      });
      for (const m of memberships) {
        if (!tenantNamesByUser.has(m.userId)) {
          tenantNamesByUser.set(m.userId, { id: m.orgId, name: m.org.name });
        }
      }
    }

    const visibleUserIds = new Set(users.map((u) => u.id));
    const items: AdminUsersUsageRow[] = grouped
      .filter((r) => r.userId && visibleUserIds.has(r.userId))
      .map((r) => {
        const userId = r.userId as string;
        const user = usersById.get(userId);
        const tenant =
          args.scope === 'org'
            ? args.tenantId
              ? { id: args.tenantId, name: '' }
              : null
            : (tenantNamesByUser.get(userId) ?? null);
        return {
          userId,
          userEmail: user?.email ?? '',
          userName: user?.name ?? '',
          tenantId: tenant?.id ?? null,
          tenantName: tenant?.name ?? null,
          totalCostUsd: decimalToNumber(r._sum.costUsd),
          totalCalls: r._count._all,
          byTaskType: (breakdownByUser.get(userId) ?? [])
            .sort((a, b) => b.costUsd - a.costUsd)
            .slice(0, 10),
        };
      });

    const hasMore = items.length > args.limit;
    const trimmed = hasMore ? items.slice(0, args.limit) : items;
    const nextCursor =
      hasMore && trimmed.length > 0
        ? encodeCursor({
            createdAt: new Date().toISOString(),
            id: trimmed[trimmed.length - 1]!.userId,
          })
        : null;
    return { items: trimmed, nextCursor };
  }

  async getCallsLog(
    args: ScopeArgs & {
      taskType?: string;
      userId?: string;
      experimentGroup?: 'A' | 'B';
      limit: number;
      cursor?: string;
    },
  ): Promise<{ items: AdminCallLogItem[]; nextCursor: string | null }> {
    const tenantWhere = this.buildTenantWhere(args);
    const where: Prisma.AiUsageLogWhereInput = { ...tenantWhere };
    if (args.taskType) where.taskType = args.taskType;
    if (args.userId) where.userId = args.userId;
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

  async getFunctionsUsage(
    args: ScopeArgs & PeriodArgs,
  ): Promise<{ items: AdminFunctionUsageRow[] }> {
    const range = periodToRange(args);
    const tenantWhere = this.buildTenantWhere(args);
    const baseWhere: Prisma.AiUsageLogWhereInput = {
      createdAt: { gte: range.gte, lt: range.lt },
      ...tenantWhere,
    };

    const routes = await this.prisma.llmTaskRoute.findMany({
      where: { tenantId: null },
    });
    const routesByTaskType = new Map(routes.map((r) => [r.taskType, r]));

    const byTaskTypeAgg = await this.prisma.aiUsageLog.groupBy({
      by: ['taskType'],
      where: { ...baseWhere, taskType: { not: null } },
      _count: { _all: true },
      _sum: {
        costUsd: true,
        durationMs: true,
        inputTokens: true,
        outputTokens: true,
      },
    });
    const failedAgg = await this.prisma.aiUsageLog.groupBy({
      by: ['taskType'],
      where: { ...baseWhere, taskType: { not: null }, success: false },
      _count: { _all: true },
    });
    const failedByTaskType = new Map(failedAgg.map((r) => [r.taskType ?? '', r._count._all]));

    const aggByTaskType = new Map(byTaskTypeAgg.map((r) => [r.taskType ?? '', r]));

    const items: AdminFunctionUsageRow[] = ALL_LLM_TASK_TYPES.map((taskType) => {
      const route = routesByTaskType.get(taskType);
      const providers = parseProvidersJson(route?.providers);
      const currentProvider =
        providers[0] !== undefined
          ? `${providers[0].provider}${providers[0].model ? `:${providers[0].model}` : ''}`
          : null;
      const fallbackChain = providers
        .slice(1)
        .map((p) => `${p.provider}${p.model ? `:${p.model}` : ''}`);
      const exp = route?.experiment as { enabled?: boolean } | null | undefined;

      const agg = aggByTaskType.get(taskType);
      const totalCalls = agg?._count._all ?? 0;
      const failedCalls = failedByTaskType.get(taskType) ?? 0;
      const totalCostUsd = decimalToNumber(agg?._sum.costUsd);
      const sumDurationMs = agg?._sum.durationMs ?? 0;
      const sumInputTokens = agg?._sum.inputTokens ?? 0;
      const sumOutputTokens = agg?._sum.outputTokens ?? 0;

      return {
        taskType,
        hasRoute: route !== undefined,
        isActive: route?.isActive ?? false,
        experimentEnabled: exp?.enabled === true,
        currentProvider,
        fallbackChain,
        totalCalls,
        failedCalls,
        failRate: totalCalls > 0 ? failedCalls / totalCalls : 0,
        avgCostUsd: totalCalls > 0 ? totalCostUsd / totalCalls : 0,
        avgDurationMs: totalCalls > 0 ? sumDurationMs / totalCalls : 0,
        avgInputTokens: totalCalls > 0 ? sumInputTokens / totalCalls : 0,
        avgOutputTokens: totalCalls > 0 ? sumOutputTokens / totalCalls : 0,
        totalCostUsd,
      };
    });

    return { items };
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

function parseProvidersJson(
  raw: Prisma.JsonValue | null | undefined,
): Array<{ provider: string; model?: string }> {
  if (!raw) return [];
  let arr: unknown;
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (
    typeof raw === 'object' &&
    raw !== null &&
    Array.isArray((raw as { providers?: unknown }).providers)
  ) {
    arr = (raw as { providers: unknown[] }).providers;
  } else {
    return [];
  }
  const result: Array<{ provider: string; model?: string }> = [];
  for (const item of arr as unknown[]) {
    if (typeof item === 'string') {
      result.push({ provider: item });
      continue;
    }
    if (typeof item === 'object' && item !== null) {
      const p = (item as { provider?: unknown }).provider;
      const m = (item as { model?: unknown }).model;
      if (typeof p === 'string') {
        result.push({
          provider: p,
          ...(typeof m === 'string' && m.length > 0 ? { model: m } : {}),
        });
      }
    }
  }
  return result;
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
