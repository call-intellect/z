import { Inject, Injectable } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import {
  classifyCapacity,
  DEFAULT_CAPACITY_THRESHOLDS,
  type CapacityClass,
  type CapacityThresholds,
} from './team-capacity.scoring';

export interface TeamCapacityRow {
  departmentId: string;
  departmentName: string;
  personCount: number;
  avgLoadPercent: number;
  maxLoadPercent: number;
  classification: CapacityClass;
}

export interface TeamCapacityResult {
  items: TeamCapacityRow[];
  overloadedCount: number;
  underloadedCount: number;
  empty: boolean;
}

@Injectable()
export class TeamCapacityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async aggregate(args: { tenantId: string }): Promise<TeamCapacityResult> {
    const thresholds = await this.resolveThresholds();

    const appts = await this.prisma.appointment.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        validTo: null,
        departmentId: { not: null },
      },
      select: {
        personId: true,
        departmentId: true,
        loadPercent: true,
        person: { select: { deletedAt: true } },
      },
      take: 50_000,
    });

    const loadByDepPerson = new Map<string, Map<string, number>>();
    for (const a of appts) {
      if (!a.departmentId) continue;
      if (a.person?.deletedAt) continue;
      const byPerson = loadByDepPerson.get(a.departmentId) ?? new Map<string, number>();
      byPerson.set(a.personId, (byPerson.get(a.personId) ?? 0) + (a.loadPercent ?? 0));
      loadByDepPerson.set(a.departmentId, byPerson);
    }

    if (loadByDepPerson.size === 0) {
      return { items: [], overloadedCount: 0, underloadedCount: 0, empty: true };
    }

    const deptIds = Array.from(loadByDepPerson.keys());
    const depts = await this.prisma.department.findMany({
      where: { id: { in: deptIds }, tenantId: args.tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(depts.map((d) => [d.id, d.name]));

    const items: TeamCapacityRow[] = [];
    let overloadedCount = 0;
    let underloadedCount = 0;

    for (const [depId, byPerson] of loadByDepPerson) {
      const loads = Array.from(byPerson.values());
      if (loads.length === 0) continue;
      const sum = loads.reduce((acc, v) => acc + v, 0);
      const avg = Math.round(sum / loads.length);
      const max = Math.max(...loads);
      const classification = classifyCapacity(avg, thresholds);
      if (classification === 'overload') overloadedCount++;
      if (classification === 'underload') underloadedCount++;
      items.push({
        departmentId: depId,
        departmentName: nameById.get(depId) ?? depId,
        personCount: loads.length,
        avgLoadPercent: avg,
        maxLoadPercent: max,
        classification,
      });
    }

    items.sort((a, b) => b.avgLoadPercent - a.avgLoadPercent);

    for (let i = 0; i < overloadedCount; i++) {
      this.metrics.incTeamCapacityOverload();
    }

    return {
      items,
      overloadedCount,
      underloadedCount,
      empty: false,
    };
  }

  private async resolveThresholds(): Promise<CapacityThresholds> {
    const [overloadPercent, underloadPercent] = await Promise.all([
      this.cfg.getDynamic<number>(
        'team_capacity.overload_percent',
        'TEAM_CAPACITY_OVERLOAD_PERCENT',
        DEFAULT_CAPACITY_THRESHOLDS.overloadPercent,
      ),
      this.cfg.getDynamic<number>(
        'team_capacity.underload_percent',
        'TEAM_CAPACITY_UNDERLOAD_PERCENT',
        DEFAULT_CAPACITY_THRESHOLDS.underloadPercent,
      ),
    ]);
    return { overloadPercent, underloadPercent };
  }
}
