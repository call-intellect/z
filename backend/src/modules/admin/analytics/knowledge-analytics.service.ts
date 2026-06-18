import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

type Period = 'day' | 'week' | 'month';

export interface EntityCounter {
  total: number;
  growth7d: number;
}

export interface KnowledgeOverview {
  period: Period;
  blocks: EntityCounter;
  entities: EntityCounter;
  themes: EntityCounter;
  links: EntityCounter;
  cards: EntityCounter;
  decisions: EntityCounter;
  insights: EntityCounter;
  ideas: EntityCounter;
  regulations: EntityCounter;
  processes: EntityCounter;
}

export interface ByOrgRow {
  tenantId: string;
  name: string;
  blocks: number;
  entities: number;
  themes: number;
}

export interface KnowledgeByOrgResult {
  period: Period;
  from: Date;
  to: Date;
  items: ByOrgRow[];
}

export interface GrowthPoint {
  date: string;
  blocksAdded: number;
  themesAdded: number;
  entitiesAdded: number;
}

export interface KnowledgeGrowthResult {
  period: 'week' | 'month';
  from: Date;
  to: Date;
  items: GrowthPoint[];
}

@Injectable()
export class KnowledgeAnalyticsService {
  private readonly logger = new Logger(KnowledgeAnalyticsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    const p = this.prisma as unknown as Record<string, unknown>;
    const required = [
      'ideaBlock',
      'entity',
      'theme',
      'ideaBlockLink',
      'card',
      'decision',
      'insight',
      'idea',
      'regulation',
      'process',
    ];
    for (const key of required) {
      if (!p[key]) {
        console.warn(
          `[KnowledgeAnalyticsService] Prisma-модель "${key}" не найдена — соответствующая статистика будет возвращать нули.`,
        );
      }
    }
  }

  async getOverview(period: Period): Promise<KnowledgeOverview> {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    const [
      blocks,
      blocks7d,
      entities,
      entities7d,
      themes,
      themes7d,
      links,
      links7d,
      cards,
      cards7d,
      decisions,
      decisions7d,
      insights,
      insights7d,
      ideas,
      ideas7d,
      regulations,
      regulations7d,
      processes,
      processes7d,
    ] = await Promise.all([
      this.safeCount('ideaBlock'),
      this.safeCount('ideaBlock', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('entity'),
      this.safeCount('entity', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('theme'),
      this.safeCount('theme', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('ideaBlockLink'),
      this.safeCount('ideaBlockLink', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('card'),
      this.safeCount('card', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('decision'),
      this.safeCount('decision', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('insight'),
      this.safeCount('insight', { firstObservedAt: { gte: sevenDaysAgo } }),
      this.safeCount('idea'),
      this.safeCount('idea', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('regulation'),
      this.safeCount('regulation', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('process'),
      this.safeCount('process', { updatedAt: { gte: sevenDaysAgo } }),
    ]);

    return {
      period,
      blocks: { total: blocks, growth7d: blocks7d },
      entities: { total: entities, growth7d: entities7d },
      themes: { total: themes, growth7d: themes7d },
      links: { total: links, growth7d: links7d },
      cards: { total: cards, growth7d: cards7d },
      decisions: { total: decisions, growth7d: decisions7d },
      insights: { total: insights, growth7d: insights7d },
      ideas: { total: ideas, growth7d: ideas7d },
      regulations: { total: regulations, growth7d: regulations7d },
      processes: { total: processes, growth7d: processes7d },
    };
  }

  async getByOrg(period: Period, limit: number): Promise<KnowledgeByOrgResult> {
    const { from, to } = this.periodRange(period);

    const [blocksByOrg, entitiesByOrg, themesByOrg] = await Promise.all([
      this.safeGroupByTenant('ideaBlock', {
        createdAt: { gte: from, lt: to },
      }),
      this.safeGroupByTenant('entity', {
        createdAt: { gte: from, lt: to },
      }),
      this.safeGroupByTenant('theme', {
        createdAt: { gte: from, lt: to },
      }),
    ]);

    const merged = new Map<string, { blocks: number; entities: number; themes: number }>();
    for (const r of blocksByOrg) {
      const slot = merged.get(r.tenantId) ?? {
        blocks: 0,
        entities: 0,
        themes: 0,
      };
      slot.blocks = r.count;
      merged.set(r.tenantId, slot);
    }
    for (const r of entitiesByOrg) {
      const slot = merged.get(r.tenantId) ?? {
        blocks: 0,
        entities: 0,
        themes: 0,
      };
      slot.entities = r.count;
      merged.set(r.tenantId, slot);
    }
    for (const r of themesByOrg) {
      const slot = merged.get(r.tenantId) ?? {
        blocks: 0,
        entities: 0,
        themes: 0,
      };
      slot.themes = r.count;
      merged.set(r.tenantId, slot);
    }

    if (merged.size === 0) {
      return { period, from, to, items: [] };
    }

    const sorted = Array.from(merged.entries()).sort((a, b) => b[1].blocks - a[1].blocks);
    const top = sorted.slice(0, limit);

    const orgs = await this.prisma.org.findMany({
      where: { id: { in: top.map(([id]) => id) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(orgs.map((o) => [o.id, o.name] as const));

    const items: ByOrgRow[] = top.map(([tenantId, agg]) => ({
      tenantId,
      name: nameById.get(tenantId) ?? '(unknown)',
      blocks: agg.blocks,
      entities: agg.entities,
      themes: agg.themes,
    }));

    return { period, from, to, items };
  }

  async getGrowth(period: 'week' | 'month'): Promise<KnowledgeGrowthResult> {
    const { from, to } = this.periodRange(period);

    const [blocksByDay, themesByDay, entitiesByDay] = await Promise.all([
      this.dailyCountSafe('IdeaBlock', 'createdAt', from, to),
      this.dailyCountSafe('Theme', 'createdAt', from, to),
      this.dailyCountSafe('Entity', 'createdAt', from, to),
    ]);

    const allDates = this.enumerateDates(from, to);

    const blocksByDate = new Map(blocksByDay.map((r) => [r.date, r.count]));
    const themesByDate = new Map(themesByDay.map((r) => [r.date, r.count]));
    const entitiesByDate = new Map(entitiesByDay.map((r) => [r.date, r.count]));

    const items: GrowthPoint[] = allDates.map((date) => ({
      date,
      blocksAdded: blocksByDate.get(date) ?? 0,
      themesAdded: themesByDate.get(date) ?? 0,
      entitiesAdded: entitiesByDate.get(date) ?? 0,
    }));

    return { period, from, to, items };
  }

  private periodRange(period: Period): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date(to);
    if (period === 'day') from.setUTCDate(from.getUTCDate() - 1);
    else if (period === 'week') from.setUTCDate(from.getUTCDate() - 7);
    else from.setUTCMonth(from.getUTCMonth() - 1);
    return { from, to };
  }

  private async safeCount(delegateName: string, where?: Record<string, unknown>): Promise<number> {
    const delegate = (this.prisma as unknown as Record<string, unknown>)[delegateName] as
      | { count?: (args: { where?: unknown }) => Promise<number> }
      | undefined;
    if (!delegate?.count) return 0;
    try {
      return await delegate.count(where ? { where } : {});
    } catch (err) {
      this.logger.warn(
        { delegate: delegateName, err: err instanceof Error ? err.message : String(err) },
        'KnowledgeAnalyticsService.safeCount: count упал, возвращаю 0',
      );
      return 0;
    }
  }

  private async safeGroupByTenant(
    delegateName: 'ideaBlock' | 'entity' | 'theme',
    where: Prisma.IdeaBlockWhereInput & Prisma.EntityWhereInput & Prisma.ThemeWhereInput,
  ): Promise<Array<{ tenantId: string; count: number }>> {
    const delegate = (this.prisma as unknown as Record<string, unknown>)[delegateName] as
      | {
          groupBy?: (
            args: unknown,
          ) => Promise<Array<{ tenantId: string; _count: { _all: number } }>>;
        }
      | undefined;
    if (!delegate?.groupBy) return [];
    try {
      const rows = await delegate.groupBy({
        by: ['tenantId'],
        where,
        _count: { _all: true },
      });
      return rows.map((r) => ({ tenantId: r.tenantId, count: r._count._all }));
    } catch (err) {
      this.logger.warn(
        { delegate: delegateName, err: err instanceof Error ? err.message : String(err) },
        'KnowledgeAnalyticsService.safeGroupByTenant: groupBy упал',
      );
      return [];
    }
  }

  private async dailyCountSafe(
    table: 'IdeaBlock' | 'Theme' | 'Entity',
    column: 'createdAt',
    from: Date,
    to: Date,
  ): Promise<Array<{ date: string; count: number }>> {
    try {
      if (!['IdeaBlock', 'Theme', 'Entity'].includes(table) || column !== 'createdAt') {
        throw new Error(`Unsupported table/column: ${table}.${column}`);
      }
      const sql = `
        SELECT TO_CHAR("${column}" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS count
        FROM "${table}"
        WHERE "${column}" >= $1 AND "${column}" < $2
        GROUP BY date
        ORDER BY date ASC
      `;
      const rows = await this.prisma.$queryRawUnsafe<Array<{ date: string; count: number }>>(
        sql,
        from,
        to,
      );
      return rows.map((r) => ({ date: r.date, count: Number(r.count) }));
    } catch (err) {
      this.logger.warn(
        { table, err: err instanceof Error ? err.message : String(err) },
        'KnowledgeAnalyticsService.dailyCountSafe: $queryRawUnsafe упал, возвращаю []',
      );
      return [];
    }
  }

  private enumerateDates(from: Date, to: Date): string[] {
    const dates: string[] = [];
    const cur = new Date(from);
    cur.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
}
