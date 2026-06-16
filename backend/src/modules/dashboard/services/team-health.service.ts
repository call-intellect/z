import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

import { CommitmentReliabilityService } from './commitment-reliability.service';
import { HangingDecisionsService } from './hanging-decisions.service';

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
  /** Число висящих решений, атрибутированных отделу (ТЗ Ф2). */
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
    @Inject(HangingDecisionsService)
    private readonly hanging: HangingDecisionsService,
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

    // Висящие решения с авторами — ОДНА выборка за tenant (запрет N+1).
    // Раскладка по отделам in-memory ниже (как conflictLinks). Правило
    // атрибуции (ТЗ Ф2): решение «висит» для отдела, если хотя бы один автор из
    // decidedByPersonIds — из этого отдела (primaryDepartmentId == dept.id).
    // Overlap допускается: одно решение может попасть в 2 отдела.
    const hangingDecisions = await this.hanging.listHangingWithAuthors({
      tenantId: args.tenantId,
    });
    // Обратная карта personId → departmentId (по primaryDepartment relation).
    const personToDept = new Map<string, string>();
    for (const dept of departments) {
      for (const p of dept.persons) personToDept.set(p.id, dept.id);
    }
    // Раскладка: для каждого решения — множество отделов-владельцев (dedup,
    // одно решение считается отделу не более одного раза).
    const decisionsByDept = new Map<string, number>();
    for (const d of hangingDecisions) {
      const depts = new Set<string>();
      for (const pid of d.decidedByPersonIds) {
        const deptId = personToDept.get(pid);
        if (deptId) depts.add(deptId);
      }
      for (const deptId of depts) {
        decisionsByDept.set(deptId, (decisionsByDept.get(deptId) ?? 0) + 1);
      }
    }

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

      // Decisions: висящие решения, атрибутированные отделу (ТЗ Ф2).
      const decisionsCount = decisionsByDept.get(dept.id) ?? 0;
      const decisions: TeamHealthAttrDto = {
        value: decisionsCount,
        tone: this.toneDecisions(decisionsCount),
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

  private toneDecisions(v: number): HealthTone {
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
