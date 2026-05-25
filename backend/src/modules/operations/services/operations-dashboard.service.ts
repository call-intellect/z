import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type EntityLinkType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';

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
  OperationsTeamTemperatureDto,
  OperationsTeamTemperaturePersonDto,
  OperationsTeamTemperatureSummaryDto,
} from '../dto/operations-dashboard.dto';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

const TEAM_FRICTION_RELATION_TYPES: EntityLinkType[] = ['conflicted_with'];
// Severity buckets для cardinality-safe Gauge.
type Severity = 'low' | 'medium' | 'high' | 'unknown';

/**
 * SBA β-8.3 Wave 2 (Фаза 2) — полный whitelist `Insight.causeCategory`.
 * Используется и в БД-фильтре (на случай странных значений), и для
 * гарантии «все 8 ключей в ответе» (UI ожидает фиксированную раскладку).
 */
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

/**
 * SBA β-8 — OperationsDashboardService.
 *
 * Агрегирует «пульс операций» для COO:
 *   - активные блокеры (DailyCheckIn.blockersJson + IdeaBlock signalType=blocker)
 *   - missed goals (status='abandoned' + cascadeMissed=true)
 *   - team friction count (EntityLink.relationType='conflicted_with')
 *   - capacity (Appointment.loadPercent сумма)
 *
 * Redis-кэш 5 минут (TTL из `cfg.betaOps.operationsDashboardCacheTtlSeconds`).
 * Ключ — `ops_dashboard:<tenantId>:<view>`. На любой error кэша — fallback на
 * direct DB (best-effort).
 *
 * Метрики (set в `recalcMetricsSnapshot`):
 *   - operations_blockers_total{severity}
 *   - team_frictions_total
 */
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

  /**
   * `GET /api/v1/dashboard/operations/overview` — pulse-агрегат.
   */
  async getOverview(args: { tenantId: string }): Promise<OperationsDashboardOverviewDto> {
    const cacheKey = `ops_dashboard:${args.tenantId}:overview`;
    const cached = await this.cacheGet<OperationsDashboardOverviewDto>(cacheKey);
    if (cached) return cached;

    const [
      blockers,
      goalsAgg,
      frictions,
      capacity,
      temperature,
      insightsByCauseCategory,
      maturity,
    ] = await Promise.all([
      this.fetchBlockers(args.tenantId, 100),
      this.fetchGoalsAgg(args.tenantId),
      this.fetchTeamFrictions(args.tenantId, 100),
      this.fetchCapacity(args.tenantId),
      // SBA β-8.1 — Температура команды за 7 дней.
      this.fetchTeamTemperature(args.tenantId, 7),
      // SBA β-8.3 Wave 2 (Фаза 2) — карта причин за 7 дней (severity ≥ medium).
      this.fetchInsightsByCauseCategory(args.tenantId, 7),
      // SBA β-8.3 Wave 2 (Фаза 3) — снапшот зрелости компании.
      this.fetchMaturitySnapshot(args.tenantId),
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
      capacityAvgPercent: capacity.avgLoadPercent,
      capacityOverloadedCount: capacity.overloadedCount,
      topRecentBlockers: blockers.slice(0, 5),
      topRecentTeamFrictions: frictions.slice(0, 5),
      teamTemperature: teamTemperatureSummary,
      insightsByCauseCategory,
      maturity,
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
    return dto;
  }

  /**
   * SBA β-8.1 — `GET /team-temperature?days=7`. Полный разрез по людям.
   */
  async getTeamTemperature(args: {
    tenantId: string;
    days: number;
  }): Promise<OperationsTeamTemperatureDto> {
    return this.fetchTeamTemperature(args.tenantId, args.days);
  }

  /** `GET /api/v1/dashboard/operations/blockers`. */
  async getBlockers(args: {
    tenantId: string;
    limit?: number;
  }): Promise<OperationsDashboardBlockersListDto> {
    const limit = Math.min(args.limit ?? 50, 200);
    const items = await this.fetchBlockers(args.tenantId, limit);
    return { items, total: items.length };
  }

  /** `GET /api/v1/dashboard/operations/team-frictions`. */
  async getTeamFrictions(args: {
    tenantId: string;
    limit?: number;
  }): Promise<OperationsDashboardTeamFrictionsListDto> {
    const limit = Math.min(args.limit ?? 50, 200);
    const items = await this.fetchTeamFrictions(args.tenantId, limit);
    return { items, total: items.length };
  }

  /** `GET /api/v1/dashboard/operations/capacity`. */
  async getCapacity(args: {
    tenantId: string;
  }): Promise<OperationsDashboardCapacityListDto> {
    return this.fetchCapacity(args.tenantId);
  }

  /**
   * Инвалидация кэша. Зовётся из CheckinResponseHandler, GoalCascadeService
   * после значимых апдейтов. Best-effort: ошибки кеша только в debug.
   */
  async invalidateCache(tenantId: string): Promise<void> {
    if (!this.redis) return;
    try {
      await Promise.all([
        this.redis.client.del(`ops_dashboard:${tenantId}:overview`),
      ]);
    } catch (err) {
      this.logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'OperationsDashboardService.invalidateCache: ignore error',
      );
    }
  }

  // ─────────────────────────── fetchers ─────────────────────────────

  private async fetchBlockers(
    tenantId: string,
    limit: number,
  ): Promise<OperationsDashboardBlockerDto[]> {
    // Источник 1 — DailyCheckIn.blockersJson за последние 7 дней.
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 7);
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId,
        createdAt: { gte: since },
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
          sourceBlockId: null,
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
  ): Promise<OperationsDashboardTeamFrictionDto[]> {
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        relationType: { in: TEAM_FRICTION_RELATION_TYPES },
        status: 'active',
        deletedAt: null,
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

    // Подтягиваем Person names через Entity → Person.
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

  /**
   * SBA β-8.1 — агрегат настроений за окно `days`. Возвращает доли
   * green/yellow/red + дельту redShare к предыдущему такому же окну.
   * Используется и в overview (summary), и в `/team-temperature` (полный
   * разрез по людям).
   */
  private async fetchTeamTemperature(
    tenantId: string,
    days: number,
  ): Promise<OperationsTeamTemperatureDto> {
    const sinceCurrent = isoDateDaysAgo(days);
    const sincePrev = isoDateDaysAgo(days * 2);

    // Берём чек-ины за два окна одним запросом — фильтр по dateLocal (строка).
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
    const byPersonMap = new Map<
      string,
      OperationsTeamTemperaturePersonDto
    >();

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
    const redShareDelta =
      prevTotal > 0 ? redShare - prevR / prevTotal : null;

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

  /**
   * SBA β-8.3 Wave 2 (Фаза 2) — агрегат insights по `causeCategory` за
   * последние `days` дней.
   *
   * Фильтры:
   *   - severity ∈ medium|high (буквально из ТЗ Wave 2);
   *   - status ≠ 'archived' (висящие insights);
   *   - firstObservedAt ≥ now − days — «появился за последние N дней»
   *     (lastObservedAt дал бы «упоминался», а нам нужно «новых причин
   *     столько-то» для виджета «Карта причин недели»).
   *
   * Возвращает все 8 ключей всегда (для предсказуемой раскладки UI).
   * Записи с `causeCategory=NULL` → bucket `'unknown'`.
   *
   * @param days окно агрегации, дефолт 7 (см. ТЗ §2.1).
   */
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
      // NULL и значения вне whitelist'а → bucket 'unknown' (защита от старых
      // данных, где LLM могла записать что-то нестандартное; и от reality
      // schema.prisma — causeCategory это String, не enum).
      const cause: OperationsInsightCauseCategory =
        row.causeCategory && whitelist.has(row.causeCategory)
          ? (row.causeCategory as OperationsInsightCauseCategory)
          : 'unknown';
      out[cause] += row._count._all;
    }
    return out;
  }

  /**
   * SBA β-8.3 Wave 2 (Фаза 3) — снапшот зрелости компании.
   *
   * Источник `score/lastCalcAt/stage` — `CompanyProfile` (1:1 на tenant,
   * пересчитывается `MaturityScorerCron` каждое утро в 05:00 UTC).
   *
   * `weakestDomains`/`topDomains` — топ-3 `FunctionalDomain` по
   * `completeness` ASC и DESC соответственно. Берём только домены с
   * `completeness IS NOT NULL` и `deletedAt IS NULL`. При пересечении
   * (доменов меньше 6) — массивы могут пересекаться по элементам, что ОК
   * для UI и явно отражает реальность: топ и weakest совпадают.
   */
  private async fetchMaturitySnapshot(
    tenantId: string,
  ): Promise<MaturitySnapshotDto> {
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
        completeness:
          d.completeness === null ? null : Number(d.completeness.toString()),
      }))
      .filter(
        (d): d is { slug: string; name: string; completeness: number } =>
          d.completeness !== null && Number.isFinite(d.completeness),
      );

    const byAsc = [...normalized].sort(
      (a, b) => a.completeness - b.completeness,
    );
    const byDesc = [...normalized].sort(
      (a, b) => b.completeness - a.completeness,
    );

    return {
      score:
        profile?.maturityScore !== null && profile?.maturityScore !== undefined
          ? Number(profile.maturityScore.toString())
          : null,
      lastCalcAt: profile?.lastMaturityCalcAt
        ? profile.lastMaturityCalcAt.toISOString()
        : null,
      stage: profile?.stage ?? null,
      weakestDomains: byAsc.slice(0, 3),
      topDomains: byDesc.slice(0, 3),
    };
  }

  private async fetchCapacity(
    tenantId: string,
  ): Promise<OperationsDashboardCapacityListDto> {
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

    const items = Array.from(byPerson.values()).sort(
      (a, b) => b.loadPercent - a.loadPercent,
    );

    const overloadedCount = items.filter((it) => it.loadPercent > 100).length;
    const avgLoadPercent =
      items.length === 0
        ? 0
        : Math.round(
            items.reduce((acc, it) => acc + it.loadPercent, 0) / items.length,
          );

    return { items, avgLoadPercent, overloadedCount };
  }

  // ─────────────────────── metrics + cache ──────────────────────────

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
    // SBA β-8.3 Wave 2 (Фаза 2) — обновляем все 8 значений (включая 0),
    // чтобы Grafana всегда видела полную раскладку категорий.
    for (const cause of INSIGHT_CAUSE_CATEGORIES) {
      this.metrics.setCooInsightsByCause({
        tenantTop,
        cause,
        value: insightsByCauseCategory[cause] ?? 0,
      });
    }
    // SBA β-8.3 Wave 2 (Фаза 3) — `maturityScore=null` означает, что
    // MaturityScorerCron ещё не отрабатывал для этого tenant'а; не публикуем
    // нули, чтобы не зашумлять метрику.
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

/**
 * SBA β-8.1 — вернуть YYYY-MM-DD (UTC), N дней назад от сегодня. Используется
 * для фильтра DailyCheckIn.dateLocal в `fetchTeamTemperature`.
 *
 * NB: используем UTC-дату как нижнюю границу — это даёт небольшую погрешность
 * на сменах суток в разных таймзонах (±1 день), но не критично для
 * 7/14/30-дневных окон агрегата.
 */
function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
