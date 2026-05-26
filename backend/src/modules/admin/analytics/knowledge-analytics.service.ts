import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Admin-redesign Фаза 2 — `KnowledgeAnalyticsService`.
 *
 * Read-only аналитика knowledge-core для UI Z-Admin раздела «Аналитика →
 * Knowledge». Отвечает за три эндпоинта:
 *  - overview      — totals + 7d/period growth по основным сущностям графа.
 *  - byOrg         — топ-Org по объёму графа за период.
 *  - growth        — ежедневный рост блоков/сущностей/тем (для line chart).
 *
 * Период `day|week|month` → окно `[now - period, now]`. 7d growth в overview
 * фиксированный (требование ТЗ §1).
 *
 * Источник правды — модели `IdeaBlock`, `Entity`, `Theme`, `IdeaBlockLink`,
 * `Card`, `Decision`, `Insight`, `Idea`, `Regulation`, `Process` из
 * [backend/prisma/schema.prisma](backend/prisma/schema.prisma). Все модели на
 * 2026-05-25 присутствуют, console.warn-fallback'и оставлены на случай
 * будущего удаления.
 */

type Period = 'day' | 'week' | 'month';

export interface EntityCounter {
  total: number;
  /** Прирост за последние 7 дней. */
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
  date: string; // YYYY-MM-DD
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
    // Sanity-check: модели Prisma client'а доступны. Если внезапно одна из
    // моделей удалится в будущем — увидим warn при boot'е, а не 500 в проде.
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

  // ─────────────────────────── public api ──────────────────────────────

  async getOverview(period: Period): Promise<KnowledgeOverview> {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

    // 10 типов сущностей; считаем total + 7d-приращение параллельно.
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
      // Insight использует firstObservedAt; createdAt отсутствует в модели.
      this.safeCount('insight', { firstObservedAt: { gte: sevenDaysAgo } }),
      this.safeCount('idea'),
      this.safeCount('idea', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('regulation'),
      this.safeCount('regulation', { createdAt: { gte: sevenDaysAgo } }),
      this.safeCount('process'),
      // Process не имеет createdAt в schema.prisma — fallback на updatedAt.
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

  /**
   * Топ-Org по объёму графа за период: blocks + entities + themes по
   * `createdAt >= from`. Сортировка — по убыванию blocks за период (главный
   * сигнал «активности» Org).
   */
  async getByOrg(period: Period, limit: number): Promise<KnowledgeByOrgResult> {
    const { from, to } = this.periodRange(period);

    // GroupBy по tenantId для трёх таблиц независимо. Затем сшиваем по
    // tenantId. На небольших объёмах Org-ов (десятки/сотни) — приемлемо.
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

    // Собираем merged map по tenantId.
    const merged = new Map<
      string,
      { blocks: number; entities: number; themes: number }
    >();
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

    // Сортируем по убыванию blocks (главный сигнал активности).
    const sorted = Array.from(merged.entries()).sort(
      (a, b) => b[1].blocks - a[1].blocks,
    );
    const top = sorted.slice(0, limit);

    // Получаем name всех попавших Org одним запросом.
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

  /**
   * Ежедневный рост блоков/сущностей/тем за период. Возвращает массив точек
   * `[{date, blocksAdded, themesAdded, entitiesAdded}]` строго по дням
   * (UTC) — для line chart на фронте.
   *
   * Группировка по дням сделана через TO_CHAR(createdAt, 'YYYY-MM-DD') в
   * raw SQL (groupBy(date) Prisma не поддерживает без $queryRaw). Все три
   * запроса — параллельно, затем стыкуются по date.
   */
  async getGrowth(period: 'week' | 'month'): Promise<KnowledgeGrowthResult> {
    const { from, to } = this.periodRange(period);

    const [blocksByDay, themesByDay, entitiesByDay] = await Promise.all([
      this.dailyCountSafe('IdeaBlock', 'createdAt', from, to),
      this.dailyCountSafe('Theme', 'createdAt', from, to),
      this.dailyCountSafe('Entity', 'createdAt', from, to),
    ]);

    // Список всех дат периода, чтобы возвращать «дырки» как 0.
    const allDates = this.enumerateDates(from, to);

    const blocksByDate = new Map(blocksByDay.map((r) => [r.date, r.count]));
    const themesByDate = new Map(themesByDay.map((r) => [r.date, r.count]));
    const entitiesByDate = new Map(
      entitiesByDay.map((r) => [r.date, r.count]),
    );

    const items: GrowthPoint[] = allDates.map((date) => ({
      date,
      blocksAdded: blocksByDate.get(date) ?? 0,
      themesAdded: themesByDate.get(date) ?? 0,
      entitiesAdded: entitiesByDate.get(date) ?? 0,
    }));

    return { period, from, to, items };
  }

  // ─────────────────────────── private ─────────────────────────────────

  private periodRange(period: Period): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date(to);
    if (period === 'day') from.setUTCDate(from.getUTCDate() - 1);
    else if (period === 'week') from.setUTCDate(from.getUTCDate() - 7);
    else from.setUTCMonth(from.getUTCMonth() - 1);
    return { from, to };
  }

  /**
   * Безопасный count: если delegate'а нет на prisma client'е (например,
   * модель удалили из schema), возвращаем 0 + warn (был выведен в
   * конструкторе). Никогда не падаем.
   */
  private async safeCount(
    delegateName: string,
    where?: Record<string, unknown>,
  ): Promise<number> {
    const delegate = (this.prisma as unknown as Record<string, unknown>)[
      delegateName
    ] as { count?: (args: { where?: unknown }) => Promise<number> } | undefined;
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

  /**
   * GroupBy по tenantId с фильтром по where. Возвращает `[{tenantId, count}]`.
   * Если delegate отсутствует — пустой массив.
   */
  private async safeGroupByTenant(
    delegateName: 'ideaBlock' | 'entity' | 'theme',
    where: Prisma.IdeaBlockWhereInput &
      Prisma.EntityWhereInput &
      Prisma.ThemeWhereInput,
  ): Promise<Array<{ tenantId: string; count: number }>> {
    const delegate = (this.prisma as unknown as Record<string, unknown>)[
      delegateName
    ] as
      | {
          groupBy?: (args: unknown) => Promise<
            Array<{ tenantId: string; _count: { _all: number } }>
          >;
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

  /**
   * Подсчёт по дням через raw SQL. Имя таблицы и колонки — параметризуем
   * не через ?, а конкатенацией (это безопасно, мы передаём только наши
   * хардкод-строки). Bind-параметры — только для from/to.
   *
   * Возвращает `[{date: 'YYYY-MM-DD', count: N}]`, отсортирован по date ASC.
   */
  private async dailyCountSafe(
    table: 'IdeaBlock' | 'Theme' | 'Entity',
    column: 'createdAt',
    from: Date,
    to: Date,
  ): Promise<Array<{ date: string; count: number }>> {
    try {
      // Whitelist: разрешаем только три имени таблицы и одну колонку. Любые
      // другие значения — отсекаются TypeScript-типом, плюс runtime-check.
      if (
        !['IdeaBlock', 'Theme', 'Entity'].includes(table) ||
        column !== 'createdAt'
      ) {
        throw new Error(`Unsupported table/column: ${table}.${column}`);
      }
      // Имена таблиц и колонок — PascalCase / camelCase из schema.prisma
      // (без @@map). Postgres требует двойных кавычек для регистра.
      const sql = `
        SELECT TO_CHAR("${column}" AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
               COUNT(*)::int AS count
        FROM "${table}"
        WHERE "${column}" >= $1 AND "${column}" < $2
        GROUP BY date
        ORDER BY date ASC
      `;
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ date: string; count: number }>
      >(sql, from, to);
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
