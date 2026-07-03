import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  LlmCostCompaniesQuery,
  LlmCostCompanyDetailQuery,
  LlmCostModelQuery,
  LlmCostModuleQuery,
  LlmCostOverviewQuery,
  LlmCostPeriod,
  LlmCostTaskTypeQuery,
} from '../dto/llm-cost-dashboard.dto';

import { LLM_COST_MODULE_LABELS, type LlmCostModule, resolveLlmCostModule } from './llm-cost-module-map';

export interface LlmCostTrendPoint {
  date: string;
  costRub: number;
}

export interface LlmCostOverviewView {
  period: LlmCostPeriod;
  totals: {
    costRub: number;
    callsCount: number;
    prevPeriodCostRub: number | null;
    changePct: number | null;
  };
  trend: LlmCostTrendPoint[];
  byModel: Array<{ model: string; costRub: number; sharePct: number }>;
  byModule: Array<{ module: LlmCostModule; label: string; costRub: number; sharePct: number }>;
  topCompanies: Array<{ tenantId: string; name: string; costRub: number; sharePct: number }>;
}

export interface LlmCostModelDetailView {
  model: string;
  totals: { costRub: number; sharePct: number };
  trend: LlmCostTrendPoint[];
  byModule: Array<{ module: LlmCostModule; label: string; costRub: number; sharePct: number }>;
}

export interface LlmCostModuleDetailView {
  module: LlmCostModule;
  label: string;
  totals: { costRub: number; sharePct: number };
  trend: LlmCostTrendPoint[];
  byTaskType: Array<{ taskType: string; costRub: number; callsCount: number }>;
}

export interface LlmCostCompanyRow {
  tenantId: string;
  name: string;
  costRub: number;
  sharePct: number;
  trend: LlmCostTrendPoint[];
}
export interface LlmCostCompaniesView {
  items: LlmCostCompanyRow[];
  nextCursor: string | null;
}

export interface LlmCostCompanyDetailView {
  tenantId: string;
  name: string;
  totals: { costRub: number };
  trend: LlmCostTrendPoint[];
  byModel: Array<{ model: string; costRub: number; sharePct: number }>;
}

export interface LlmCostTaskTypeDetailView {
  taskType: string;
  module: LlmCostModule;
  totals: { costRub: number; callsCount: number };
  trend: LlmCostTrendPoint[];
}

interface CompaniesCursor {
  costRub: number;
  tenantId: string;
}

function encodeCompaniesCursor(c: CompaniesCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf-8').toString('base64');
}

function decodeCompaniesCursor(raw: string | undefined): CompaniesCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, 'base64').toString('utf-8');
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).costRub === 'number' &&
      typeof (parsed as Record<string, unknown>).tenantId === 'string'
    ) {
      return parsed as CompaniesCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function decimalToNumber(v: Prisma.Decimal | number | null | undefined): number {
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

function sharePct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

@Injectable()
export class LlmCostDashboardService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private periodToDays(period: LlmCostPeriod): number {
    return period === '7d' ? 7 : period === '30d' ? 30 : 90;
  }

  private dateRange(period: LlmCostPeriod): { gte: Date; lt: Date; prevGte: Date } {
    const days = this.periodToDays(period);
    const now = new Date();
    const lt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const gte = new Date(lt.getTime() - days * 86_400_000);
    const prevGte = new Date(gte.getTime() - days * 86_400_000);
    return { gte, lt, prevGte };
  }

  private async buildTrend(
    where: Prisma.AiCostDailyWhereInput,
    granularity: 'day' | 'week',
  ): Promise<LlmCostTrendPoint[]> {
    const rows = await this.prisma.aiCostDaily.groupBy({
      by: ['date'],
      where,
      _sum: { costRub: true },
      orderBy: { date: 'asc' },
    });
    if (granularity === 'day') {
      return rows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        costRub: decimalToNumber(r._sum.costRub),
      }));
    }
    const byWeek = new Map<string, number>();
    for (const r of rows) {
      const d = r.date;
      const day = (d.getUTCDay() + 6) % 7;
      const monday = new Date(d.getTime() - day * 86_400_000);
      const key = monday.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + decimalToNumber(r._sum.costRub));
    }
    return [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, costRub]) => ({ date, costRub }));
  }

  async overview(q: LlmCostOverviewQuery): Promise<LlmCostOverviewView> {
    const { gte, lt, prevGte } = this.dateRange(q.period);
    const where: Prisma.AiCostDailyWhereInput = { date: { gte, lt } };
    const prevWhere: Prisma.AiCostDailyWhereInput = { date: { gte: prevGte, lt: gte } };

    const [totalsAgg, prevTotalsAgg, byModelRows, byTaskTypeRows, byTenantRows, trend] =
      await Promise.all([
        this.prisma.aiCostDaily.aggregate({
          where,
          _sum: { costRub: true, callsCount: true },
        }),
        this.prisma.aiCostDaily.aggregate({ where: prevWhere, _sum: { costRub: true } }),
        this.prisma.aiCostDaily.groupBy({ by: ['model'], where, _sum: { costRub: true } }),
        this.prisma.aiCostDaily.groupBy({ by: ['taskType'], where, _sum: { costRub: true } }),
        this.prisma.aiCostDaily.groupBy({
          by: ['tenantId'],
          where,
          _sum: { costRub: true },
          orderBy: { _sum: { costRub: 'desc' } },
          take: 20,
        }),
        this.buildTrend(where, q.trend),
      ]);

    const totalCostRub = decimalToNumber(totalsAgg._sum.costRub);
    const callsCount = totalsAgg._sum.callsCount ?? 0;
    const prevPeriodCostRub = decimalToNumber(prevTotalsAgg._sum.costRub);
    const changePct =
      prevPeriodCostRub > 0
        ? ((totalCostRub - prevPeriodCostRub) / prevPeriodCostRub) * 100
        : null;

    const byModel = byModelRows
      .map((r) => ({ model: r.model, costRub: decimalToNumber(r._sum.costRub) }))
      .sort((a, b) => b.costRub - a.costRub)
      .map((r) => ({ ...r, sharePct: sharePct(r.costRub, totalCostRub) }));

    const byModuleAgg = new Map<LlmCostModule, number>();
    for (const r of byTaskTypeRows) {
      const module = resolveLlmCostModule(r.taskType);
      byModuleAgg.set(module, (byModuleAgg.get(module) ?? 0) + decimalToNumber(r._sum.costRub));
    }
    const byModule = [...byModuleAgg.entries()]
      .map(([module, costRub]) => ({
        module,
        label: LLM_COST_MODULE_LABELS[module],
        costRub,
        sharePct: sharePct(costRub, totalCostRub),
      }))
      .sort((a, b) => b.costRub - a.costRub);

    const tenantIds = byTenantRows.map((r) => r.tenantId);
    const orgs =
      tenantIds.length > 0
        ? await this.prisma.org.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
          })
        : [];
    const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));
    const topCompanies = byTenantRows.map((r) => {
      const costRub = decimalToNumber(r._sum.costRub);
      return {
        tenantId: r.tenantId,
        name: orgNameById.get(r.tenantId) ?? r.tenantId,
        costRub,
        sharePct: sharePct(costRub, totalCostRub),
      };
    });

    return {
      period: q.period,
      totals: { costRub: totalCostRub, callsCount, prevPeriodCostRub, changePct },
      trend,
      byModel,
      byModule,
      topCompanies,
    };
  }

  async modelDetail(model: string, q: LlmCostModelQuery): Promise<LlmCostModelDetailView> {
    const { gte, lt } = this.dateRange(q.period);
    const whereAll: Prisma.AiCostDailyWhereInput = { date: { gte, lt } };
    const whereModel: Prisma.AiCostDailyWhereInput = { ...whereAll, model };

    const [totalsAgg, modelAgg, byTaskTypeRows, trend] = await Promise.all([
      this.prisma.aiCostDaily.aggregate({ where: whereAll, _sum: { costRub: true } }),
      this.prisma.aiCostDaily.aggregate({ where: whereModel, _sum: { costRub: true } }),
      this.prisma.aiCostDaily.groupBy({
        by: ['taskType'],
        where: whereModel,
        _sum: { costRub: true },
      }),
      this.buildTrend(whereModel, q.trend),
    ]);

    const totalCostRub = decimalToNumber(totalsAgg._sum.costRub);
    const modelCostRub = decimalToNumber(modelAgg._sum.costRub);

    const byModuleAgg = new Map<LlmCostModule, number>();
    for (const r of byTaskTypeRows) {
      const module = resolveLlmCostModule(r.taskType);
      byModuleAgg.set(module, (byModuleAgg.get(module) ?? 0) + decimalToNumber(r._sum.costRub));
    }
    const byModule = [...byModuleAgg.entries()]
      .map(([module, costRub]) => ({
        module,
        label: LLM_COST_MODULE_LABELS[module],
        costRub,
        sharePct: sharePct(costRub, modelCostRub),
      }))
      .sort((a, b) => b.costRub - a.costRub);

    return {
      model,
      totals: { costRub: modelCostRub, sharePct: sharePct(modelCostRub, totalCostRub) },
      trend,
      byModule,
    };
  }

  async moduleDetail(module: LlmCostModule, q: LlmCostModuleQuery): Promise<LlmCostModuleDetailView> {
    const { gte, lt } = this.dateRange(q.period);
    const whereAll: Prisma.AiCostDailyWhereInput = { date: { gte, lt } };

    const [totalsAgg, byTaskTypeAllRows] = await Promise.all([
      this.prisma.aiCostDaily.aggregate({ where: whereAll, _sum: { costRub: true } }),
      this.prisma.aiCostDaily.groupBy({
        by: ['taskType'],
        where: whereAll,
        _sum: { costRub: true, callsCount: true },
      }),
    ]);

    const byTaskTypeForModule = byTaskTypeAllRows.filter(
      (r) => resolveLlmCostModule(r.taskType) === module,
    );
    const totalCostRub = decimalToNumber(totalsAgg._sum.costRub);
    const moduleCostRub = byTaskTypeForModule.reduce(
      (sum, r) => sum + decimalToNumber(r._sum.costRub),
      0,
    );

    const taskTypesInModule = byTaskTypeForModule.map((r) => r.taskType);
    const trend =
      taskTypesInModule.length > 0
        ? await this.buildTrend({ ...whereAll, taskType: { in: taskTypesInModule } }, q.trend)
        : [];

    const byTaskType = byTaskTypeForModule
      .map((r) => ({
        taskType: r.taskType,
        costRub: decimalToNumber(r._sum.costRub),
        callsCount: r._sum.callsCount ?? 0,
      }))
      .sort((a, b) => b.costRub - a.costRub);

    return {
      module,
      label: LLM_COST_MODULE_LABELS[module],
      totals: { costRub: moduleCostRub, sharePct: sharePct(moduleCostRub, totalCostRub) },
      trend,
      byTaskType,
    };
  }

  async companies(q: LlmCostCompaniesQuery): Promise<LlmCostCompaniesView> {
    const { gte, lt } = this.dateRange(q.period);
    const where: Prisma.AiCostDailyWhereInput = { date: { gte, lt } };

    let tenantFilter: string[] | undefined;
    if (q.search) {
      const orgs = await this.prisma.org.findMany({
        where: {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { slug: { contains: q.search, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      tenantFilter = orgs.map((o) => o.id);
      if (tenantFilter.length === 0) {
        return { items: [], nextCursor: null };
      }
    }

    const byTenantRows = await this.prisma.aiCostDaily.groupBy({
      by: ['tenantId'],
      where: { ...where, ...(tenantFilter ? { tenantId: { in: tenantFilter } } : {}) },
      _sum: { costRub: true },
    });

    const totalCostRub = byTenantRows.reduce((sum, r) => sum + decimalToNumber(r._sum.costRub), 0);

    let sortedRows = byTenantRows
      .map((r) => ({ tenantId: r.tenantId, costRub: decimalToNumber(r._sum.costRub) }))
      .sort((a, b) =>
        b.costRub !== a.costRub ? b.costRub - a.costRub : a.tenantId.localeCompare(b.tenantId),
      );

    const cursor = decodeCompaniesCursor(q.cursor);
    if (cursor) {
      sortedRows = sortedRows.filter(
        (r) =>
          r.costRub < cursor.costRub ||
          (r.costRub === cursor.costRub && r.tenantId > cursor.tenantId),
      );
    }

    const page = sortedRows.slice(0, q.limit);
    const hasMore = sortedRows.length > q.limit;

    const orgs =
      page.length > 0
        ? await this.prisma.org.findMany({
            where: { id: { in: page.map((r) => r.tenantId) } },
            select: { id: true, name: true },
          })
        : [];
    const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

    const items: LlmCostCompanyRow[] = await Promise.all(
      page.map(async (r) => ({
        tenantId: r.tenantId,
        name: orgNameById.get(r.tenantId) ?? r.tenantId,
        costRub: r.costRub,
        sharePct: sharePct(r.costRub, totalCostRub),
        trend: await this.buildTrend({ tenantId: r.tenantId, date: { gte, lt } }, 'day'),
      })),
    );

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCompaniesCursor({ costRub: last.costRub, tenantId: last.tenantId })
        : null;

    return { items, nextCursor };
  }

  async companyDetail(
    tenantId: string,
    q: LlmCostCompanyDetailQuery,
  ): Promise<LlmCostCompanyDetailView> {
    const { gte, lt } = this.dateRange(q.period);
    const where: Prisma.AiCostDailyWhereInput = { tenantId, date: { gte, lt } };

    const [org, totalsAgg, byModelRows, trend] = await Promise.all([
      this.prisma.org.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
      this.prisma.aiCostDaily.aggregate({ where, _sum: { costRub: true } }),
      this.prisma.aiCostDaily.groupBy({ by: ['model'], where, _sum: { costRub: true } }),
      this.buildTrend(where, q.trend),
    ]);

    const totalCostRub = decimalToNumber(totalsAgg._sum.costRub);
    const byModel = byModelRows
      .map((r) => ({ model: r.model, costRub: decimalToNumber(r._sum.costRub) }))
      .sort((a, b) => b.costRub - a.costRub)
      .map((r) => ({ ...r, sharePct: sharePct(r.costRub, totalCostRub) }));

    return {
      tenantId,
      name: org?.name ?? tenantId,
      totals: { costRub: totalCostRub },
      trend,
      byModel,
    };
  }

  async taskTypeDetail(
    taskType: string,
    q: LlmCostTaskTypeQuery,
  ): Promise<LlmCostTaskTypeDetailView> {
    const { gte, lt } = this.dateRange(q.period);
    const where: Prisma.AiCostDailyWhereInput = { taskType, date: { gte, lt } };

    const [totalsAgg, trend] = await Promise.all([
      this.prisma.aiCostDaily.aggregate({ where, _sum: { costRub: true, callsCount: true } }),
      this.buildTrend(where, q.trend),
    ]);

    return {
      taskType,
      module: resolveLlmCostModule(taskType),
      totals: {
        costRub: decimalToNumber(totalsAgg._sum.costRub),
        callsCount: totalsAgg._sum.callsCount ?? 0,
      },
      trend,
    };
  }
}
