import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

import { CommitmentReliabilityService } from './commitment-reliability.service';

/**
 * Health tone — цвет UI-чипа. `neutral` используется когда отдел ниже cohort
 * или метрика не применима в v1.
 */
export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral';

/**
 * Один атрибут здоровья команды (sentiment / promises / conflicts / decisions).
 */
export interface TeamHealthAttrDto {
  /** Текущее значение (число — % или индекс или счётчик). */
  value: number;
  /** Цвет UI-чипа. */
  tone: HealthTone;
  /** Тренд (для sentiment и promises). Не возвращается для decisions/conflicts. */
  trend?: 'up' | 'flat' | 'down';
  /** Дельта к предыдущему окну (для promises). */
  delta?: number | null;
}

/** Строка таблицы здоровья команды — один отдел. */
export interface TeamHealthRowDto {
  departmentId: string;
  departmentName: string;
  size: number;
  /** true — отдел меньше cohort threshold (3 чел.), показываем заглушку. */
  belowCohort: boolean;
  /** Индекс настроения, -100..+100. */
  sentiment: TeamHealthAttrDto;
  /** Надёжность обещаний, 0..100 %. */
  promises: TeamHealthAttrDto;
  /** Число пар-конфликтов внутри отдела. */
  conflicts: TeamHealthAttrDto;
  /**
   * Висящие решения per-dept — в v1 не считаем (TZ Wave 1 §1.6).
   * Полная импл — в Wave 6.x. Возвращаем neutral-плейсхолдер.
   */
  decisions: TeamHealthAttrDto;
}

export interface TeamHealthDto {
  teams: TeamHealthRowDto[];
  /** Общее число отделов в tenant (для UI «X из Y отделов выше cohort»). */
  totalDepartments: number;
}

/**
 * TeamHealthService — Pulse Wave 1 §1.6 «Team Health Grid».
 *
 * Возвращает таблицу здоровья команд (по отделам) для главного дашборда
 * директора: per-dept агрегаты по 4 метрикам (sentiment / promises /
 * conflicts / decisions).
 *
 * Принципы (§1.2):
 *   - cohort ≥ 3 человека — иначе показываем `belowCohort: true` и не
 *     считаем индексы (анти-доксинг + статистика);
 *   - переиспользуем готовые сервисы:
 *       * `OperationsDashboardService.getTeamTemperature` — sentiment per-person,
 *       * `CommitmentReliabilityService.getReliability({scope:'team'})` — promises,
 *       * `EntityLink.relationType='conflicted_with'` — conflicts.
 *
 * Кэш — Redis с TTL 5 минут (`team_health:<tenantId>`). На ошибки Redis
 * сервис не падает.
 */
@Injectable()
export class TeamHealthService {
  private readonly logger = new Logger(TeamHealthService.name);

  /** Min cohort size для агрегатов (анти-доксинг + статистика). ТЗ §1.2 принцип 6. */
  private static readonly MIN_COHORT_SIZE = 3;
  /** Порог дельты (доля 0..1), при превышении считается трендом 'up'/'down'. */
  private static readonly TREND_THRESHOLD = 0.05;
  private static readonly CACHE_TTL_SEC = 300;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CommitmentReliabilityService)
    private readonly commits: CommitmentReliabilityService,
    @Inject(OperationsDashboardService)
    private readonly ops: OperationsDashboardService,
  ) {}

  async getHealth(args: { tenantId: string }): Promise<TeamHealthDto> {
    const cacheKey = `team_health:${args.tenantId}`;
    try {
      const cached = await this.redis.client.get(cacheKey);
      if (cached) return JSON.parse(cached) as TeamHealthDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const departments = await this.prisma.department.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        persons: {
          where: { deletedAt: null },
          select: { id: true, entityId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    // Загружаем sentiment per-person (за 7 дней) одной выборкой.
    const temperature = await this.ops.getTeamTemperature({
      tenantId: args.tenantId,
      days: 7,
    });
    const sentimentByPerson = new Map<
      string,
      { green: number; red: number; total: number }
    >();
    for (const p of temperature.byPerson) {
      sentimentByPerson.set(p.personId, {
        green: p.green,
        red: p.red,
        total: p.total,
      });
    }

    // Загружаем EntityLink conflict (одной выборкой за tenant).
    const conflictLinks = await this.prisma.entityLink.findMany({
      where: {
        tenantId: args.tenantId,
        relationType: 'conflicted_with',
        status: 'active',
        deletedAt: null,
      },
      select: { fromEntityId: true, toEntityId: true },
    });

    const teams: TeamHealthRowDto[] = [];

    for (const dept of departments) {
      const size = dept.persons.length;

      if (size < TeamHealthService.MIN_COHORT_SIZE) {
        teams.push(this.belowCohortRow(dept.id, dept.name, size));
        continue;
      }

      const personIds = new Set(dept.persons.map((p) => p.id));
      const entityIds = new Set(
        dept.persons
          .map((p) => p.entityId)
          .filter((id): id is string => !!id),
      );

      // Sentiment: агрегат по persons отдела.
      const sentiment = this.computeSentiment(personIds, sentimentByPerson);

      // Promises: переиспользуем CommitmentReliabilityService с scope='team'.
      const promisesRes = await this.commits.getReliability({
        tenantId: args.tenantId,
        scope: 'team',
        scopeId: dept.id,
      });
      const promises: TeamHealthAttrDto = {
        value: promisesRes.reliabilityPercent,
        tone: this.tonePromises(promisesRes.reliabilityPercent),
        delta: promisesRes.delta14d,
        ...(promisesRes.delta14d !== null && {
          trend: this.deltaToTrend(promisesRes.delta14d / 100),
        }),
      };

      // Conflicts: счётчик пар где хотя бы одна из сторон — entity-id отдела.
      const conflictsInDept = conflictLinks.filter(
        (l) =>
          (l.fromEntityId && entityIds.has(l.fromEntityId)) ||
          (l.toEntityId && entityIds.has(l.toEntityId)),
      ).length;
      const conflicts: TeamHealthAttrDto = {
        value: conflictsInDept,
        tone: this.toneConflicts(conflictsInDept),
      };

      // Decisions: v1 — neutral plug (per-dept hanging-decisions в Wave 6.x).
      const decisions: TeamHealthAttrDto = {
        value: 0,
        tone: 'neutral',
      };

      teams.push({
        departmentId: dept.id,
        departmentName: dept.name,
        size,
        belowCohort: false,
        sentiment,
        promises,
        conflicts,
        decisions,
      });
    }

    const result: TeamHealthDto = {
      teams,
      totalDepartments: departments.length,
    };

    try {
      await this.redis.client.set(
        cacheKey,
        JSON.stringify(result),
        'EX',
        TeamHealthService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${cacheKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return result;
  }

  // ─────────────────────────── private ────────────────────────────

  private computeSentiment(
    personIds: Set<string>,
    map: Map<string, { green: number; red: number; total: number }>,
  ): TeamHealthAttrDto {
    let green = 0;
    let red = 0;
    let total = 0;
    for (const pid of personIds) {
      const v = map.get(pid);
      if (!v) continue;
      green += v.green;
      red += v.red;
      total += v.total;
    }
    if (total === 0) {
      return { value: 0, tone: 'neutral' };
    }
    const value = Math.round(((green - red) / total) * 100);
    return {
      value,
      tone: this.toneSentiment(value),
    };
  }

  private toneSentiment(v: number): HealthTone {
    if (v >= 30) return 'success';
    if (v >= 0) return 'warning';
    return 'danger';
  }

  private tonePromises(v: number): HealthTone {
    if (v >= 80) return 'success';
    if (v >= 60) return 'warning';
    return 'danger';
  }

  private toneConflicts(v: number): HealthTone {
    if (v === 0) return 'success';
    if (v <= 2) return 'warning';
    return 'danger';
  }

  private deltaToTrend(delta: number): 'up' | 'flat' | 'down' {
    if (delta > TeamHealthService.TREND_THRESHOLD) return 'up';
    if (delta < -TeamHealthService.TREND_THRESHOLD) return 'down';
    return 'flat';
  }

  private belowCohortRow(
    id: string,
    name: string,
    size: number,
  ): TeamHealthRowDto {
    const neutral: TeamHealthAttrDto = { value: 0, tone: 'neutral' };
    return {
      departmentId: id,
      departmentName: name,
      size,
      belowCohort: true,
      sentiment: neutral,
      promises: neutral,
      conflicts: neutral,
      decisions: neutral,
    };
  }
}
