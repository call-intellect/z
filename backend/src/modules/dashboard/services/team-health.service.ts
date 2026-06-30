import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

import { CommitmentReliabilityService } from './commitment-reliability.service';

export type HealthTone = 'success' | 'warning' | 'danger' | 'neutral';

export interface TeamHealthAttrDto {
  value: number;
  tone: HealthTone;
  trend?: 'up' | 'flat' | 'down';
  delta?: number | null;
}

export type TeamHealthFactorLevel = 'low' | 'medium' | 'high';

export interface TeamHealthSummaryDto {
  factors: {
    manager_support: TeamHealthFactorLevel;
    workload_fairness: TeamHealthFactorLevel;
    communication: TeamHealthFactorLevel;
    time_pressure: TeamHealthFactorLevel;
    role_clarity: TeamHealthFactorLevel;
  };
  summary: string;
  generatedAt: string;
}

export interface TeamHealthRowDto {
  departmentId: string;
  departmentName: string;
  size: number;
  belowCohort: boolean;
  sentiment: TeamHealthAttrDto;
  promises: TeamHealthAttrDto;
  conflicts: TeamHealthAttrDto;
  healthSummary?: TeamHealthSummaryDto | null;
}

export interface TeamHealthDto {
  teams: TeamHealthRowDto[];
  totalDepartments: number;
}

@Injectable()
export class TeamHealthService {
  private readonly logger = new Logger(TeamHealthService.name);

  private static readonly MIN_COHORT_SIZE = 3;
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
        healthSummaryJson: true,
        persons: {
          where: { deletedAt: null },
          select: { id: true, entityId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const temperature = await this.ops.getTeamTemperature({
      tenantId: args.tenantId,
      days: 7,
    });
    const sentimentByPerson = new Map<string, { green: number; red: number; total: number }>();
    for (const p of temperature.byPerson) {
      sentimentByPerson.set(p.personId, {
        green: p.green,
        red: p.red,
        total: p.total,
      });
    }

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
        dept.persons.map((p) => p.entityId).filter((id): id is string => !!id),
      );

      const sentiment = this.computeSentiment(personIds, sentimentByPerson);

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

      const conflictsInDept = conflictLinks.filter(
        (l) =>
          (l.fromEntityId && entityIds.has(l.fromEntityId)) ||
          (l.toEntityId && entityIds.has(l.toEntityId)),
      ).length;
      const conflicts: TeamHealthAttrDto = {
        value: conflictsInDept,
        tone: this.toneConflicts(conflictsInDept),
      };

      teams.push({
        departmentId: dept.id,
        departmentName: dept.name,
        size,
        belowCohort: false,
        sentiment,
        promises,
        conflicts,
        healthSummary: this.parseHealthSummary(dept.healthSummaryJson),
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

  private parseHealthSummary(json: unknown): TeamHealthSummaryDto | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const obj = json as Record<string, unknown>;
    const factors = obj.factors;
    const summary = obj.summary;
    if (!factors || typeof factors !== 'object' || Array.isArray(factors)) return null;
    if (typeof summary !== 'string') return null;
    const f = factors as Record<string, unknown>;
    const keys = [
      'manager_support',
      'workload_fairness',
      'communication',
      'time_pressure',
      'role_clarity',
    ] as const;
    const isLevel = (v: unknown): v is TeamHealthFactorLevel =>
      v === 'low' || v === 'medium' || v === 'high';
    const parsed = {} as TeamHealthSummaryDto['factors'];
    for (const k of keys) {
      if (!isLevel(f[k])) return null;
      parsed[k] = f[k];
    }
    return {
      factors: parsed,
      summary,
      generatedAt: typeof obj.generatedAt === 'string' ? obj.generatedAt : '',
    };
  }

  private belowCohortRow(id: string, name: string, size: number): TeamHealthRowDto {
    const neutral: TeamHealthAttrDto = { value: 0, tone: 'neutral' };
    return {
      departmentId: id,
      departmentName: name,
      size,
      belowCohort: true,
      sentiment: neutral,
      promises: neutral,
      conflicts: neutral,
      healthSummary: null,
    };
  }
}
