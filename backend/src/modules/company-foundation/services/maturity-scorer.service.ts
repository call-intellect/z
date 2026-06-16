import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  MaturityOverviewDto,
  MaturityScope,
  MaturityScopeDetailDto,
  RebuildMaturityResponseDto,
} from '../dto/maturity.dto';
import { tenantTopLabel } from '../utils/tenant-top';

import { CompanyProfileService } from './company-profile.service';

@Injectable()
export class MaturityScorerService {
  private readonly logger = new Logger(MaturityScorerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompanyProfileService)
    private readonly companyProfile: CompanyProfileService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async rebuildAllOrgs(): Promise<{
    orgsScanned: number;
    rolesUpdated: number;
    departmentsUpdated: number;
    companiesUpdated: number;
  }> {
    const orgs = await this.prisma.org.findMany({ select: { id: true } });
    let rolesUpdated = 0;
    let departmentsUpdated = 0;
    let companiesUpdated = 0;
    for (const org of orgs) {
      const r = await this.rebuildForTenant({ tenantId: org.id });
      rolesUpdated += r.scopes.roles.updated;
      departmentsUpdated += r.scopes.departments.updated;
      if (r.scopes.company.updated) companiesUpdated += 1;
    }
    return {
      orgsScanned: orgs.length,
      rolesUpdated,
      departmentsUpdated,
      companiesUpdated,
    };
  }

  async rebuildForTenant(args: { tenantId: string }): Promise<RebuildMaturityResponseDto> {
    const startedAt = Date.now();
    const stop = this.metrics.startMaturityScorerTimer({ scope: 'tenant' });

    const roles = await this.prisma.role.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      include: {
        roleProfile: { select: { summaryCache: true } },
        responsibilityElements: { select: { id: true } },
        authorityBoundaries: { select: { id: true } },
      },
    });

    const probeRatio = await this.computeProbeClosedRatio(args.tenantId);

    let rolesUpdated = 0;
    const roleScoreById = new Map<string, number>();
    for (const role of roles) {
      const completeness = this.estimateRoleCompleteness(role);
      const cardCount = role.responsibilityElements.length + role.authorityBoundaries.length;
      const cardScore = Math.min(cardCount / 10, 1);
      const score = completeness * 0.4 + cardScore * 0.3 + probeRatio * 0.3;
      const capped = Math.max(0, Math.min(1, score));
      roleScoreById.set(role.id, capped);
      const prev = role.maturityScore ? Number(role.maturityScore) : null;
      if (prev === null || Math.abs(prev - capped) >= 0.001) {
        await this.prisma.role.update({
          where: { id: role.id },
          data: { maturityScore: new Prisma.Decimal(capped) },
        });
        rolesUpdated++;
      }
    }

    const departments = await this.prisma.department.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      include: { roles: { where: { deletedAt: null }, select: { id: true } } },
    });
    let departmentsUpdated = 0;
    const departmentScoreById = new Map<string, number>();
    for (const dep of departments) {
      const scores = dep.roles
        .map((r) => roleScoreById.get(r.id))
        .filter((v): v is number => typeof v === 'number');
      if (scores.length === 0) {
        continue;
      }
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const capped = Math.max(0, Math.min(1, avg));
      departmentScoreById.set(dep.id, capped);
      const prev = dep.completeness ? Number(dep.completeness) : null;
      if (prev === null || Math.abs(prev - capped) >= 0.001) {
        await this.prisma.department.update({
          where: { id: dep.id },
          data: { completeness: new Prisma.Decimal(capped) },
        });
        departmentsUpdated++;
      }
    }

    const totalWeight = departments.reduce((acc, d) => acc + Math.max(1, d.roles.length), 0);
    let companyUpdated = false;
    if (totalWeight > 0 && departmentScoreById.size > 0) {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const dep of departments) {
        const sc = departmentScoreById.get(dep.id);
        if (sc === undefined) continue;
        const w = Math.max(1, dep.roles.length);
        weightedSum += sc * w;
        weightTotal += w;
      }
      const companyScore = weightTotal > 0 ? weightedSum / weightTotal : 0;
      const capped = Math.max(0, Math.min(1, companyScore));
      const existing = await this.companyProfile.getRaw(args.tenantId);
      const prev = existing?.maturityScore ? Number(existing.maturityScore) : null;
      if (prev === null || Math.abs(prev - capped) >= 0.001) {
        await this.companyProfile.applyMaturity({
          tenantId: args.tenantId,
          maturityScore: capped,
        });
        companyUpdated = true;
      }
      const tenantTop = await tenantTopLabel(this.prisma, args.tenantId);
      this.metrics.setMaturityScoreAvg({
        tenantTop,
        scope: 'company',
        value: capped,
      });
      const rolesAvg =
        roles.length > 0
          ? Array.from(roleScoreById.values()).reduce((a, b) => a + b, 0) /
            Math.max(1, roleScoreById.size)
          : 0;
      this.metrics.setMaturityScoreAvg({
        tenantTop,
        scope: 'role',
        value: rolesAvg,
      });
      const depAvg =
        departments.length > 0 && departmentScoreById.size > 0
          ? Array.from(departmentScoreById.values()).reduce((a, b) => a + b, 0) /
            departmentScoreById.size
          : 0;
      this.metrics.setMaturityScoreAvg({
        tenantTop,
        scope: 'department',
        value: depAvg,
      });
      this.metrics.setCompanyProfileCompleteness({
        tenantTop,
        value: capped,
      });
    }

    stop();

    return {
      ok: true as const,
      scopes: {
        roles: { scanned: roles.length, updated: rolesUpdated },
        departments: {
          scanned: departments.length,
          updated: departmentsUpdated,
        },
        company: { updated: companyUpdated },
      },
      durationMs: Date.now() - startedAt,
    };
  }

  async overview(tenantId: string): Promise<MaturityOverviewDto> {
    const [profile, roles, departments, domains] = await Promise.all([
      this.companyProfile.getRaw(tenantId),
      this.prisma.role.findMany({
        where: { tenantId, deletedAt: null },
        select: { maturityScore: true },
      }),
      this.prisma.department.findMany({
        where: { tenantId, deletedAt: null },
        select: { completeness: true },
      }),
      this.prisma.functionalDomain.findMany({
        where: { tenantId, deletedAt: null },
        select: { completeness: true },
      }),
    ]);
    const rolesScored = roles.filter((r) => r.maturityScore !== null);
    const depsScored = departments.filter((d) => d.completeness !== null);
    const domainsScored = domains.filter((d) => d.completeness !== null);
    const avgRole = rolesScored.length
      ? rolesScored.reduce((a, b) => a + Number(b.maturityScore), 0) / rolesScored.length
      : null;
    const avgDep = depsScored.length
      ? depsScored.reduce((a, b) => a + Number(b.completeness), 0) / depsScored.length
      : null;

    const buckets = [
      { bucket: '0.0-0.2', min: 0, max: 0.2 },
      { bucket: '0.2-0.4', min: 0.2, max: 0.4 },
      { bucket: '0.4-0.6', min: 0.4, max: 0.6 },
      { bucket: '0.6-0.8', min: 0.6, max: 0.8 },
      { bucket: '0.8-1.0', min: 0.8, max: 1.0001 },
    ];
    const distribution = buckets.map((b) => ({
      bucket: b.bucket,
      count: rolesScored.filter((r) => {
        const v = Number(r.maturityScore);
        return v >= b.min && v < b.max;
      }).length,
    }));

    return {
      companyScore: profile?.maturityScore ? Number(profile.maturityScore) : null,
      lastCalcAt: profile?.lastMaturityCalcAt ? profile.lastMaturityCalcAt.toISOString() : null,
      averageRoleScore: avgRole,
      averageDepartmentScore: avgDep,
      rolesTotal: roles.length,
      rolesScored: rolesScored.length,
      departmentsTotal: departments.length,
      departmentsScored: depsScored.length,
      domainsTotal: domains.length,
      domainsScored: domainsScored.length,
      distribution,
    };
  }

  async scopeDetail(args: {
    tenantId: string;
    scope: MaturityScope;
    id: string;
  }): Promise<MaturityScopeDetailDto> {
    if (args.scope === 'role') {
      const role = await this.prisma.role.findUnique({
        where: { id: args.id },
        include: {
          responsibilityElements: { select: { id: true } },
          authorityBoundaries: { select: { id: true } },
        },
      });
      if (!role || role.tenantId !== args.tenantId) {
        throw new NotFoundError('Role не найдена');
      }
      const completeness = this.estimateRoleCompleteness({
        ...role,
        roleProfile: null,
      });
      return {
        scope: 'role',
        id: role.id,
        name: role.name,
        maturityScore: role.maturityScore ? Number(role.maturityScore) : null,
        completeness,
        contributingFactors: [
          { label: 'Полнота описания', value: completeness, weight: 0.4 },
          {
            label: 'Опорные карточки',
            value: Math.min(
              (role.responsibilityElements.length + role.authorityBoundaries.length) / 10,
              1,
            ),
            weight: 0.3,
          },
          {
            label: 'Probe-отклик',
            value: await this.computeProbeClosedRatio(args.tenantId),
            weight: 0.3,
          },
        ],
      };
    }
    if (args.scope === 'department') {
      const dep = await this.prisma.department.findUnique({
        where: { id: args.id },
        include: {
          roles: {
            where: { deletedAt: null },
            select: { id: true, name: true, maturityScore: true },
          },
        },
      });
      if (!dep || dep.tenantId !== args.tenantId) {
        throw new NotFoundError('Department не найден');
      }
      return {
        scope: 'department',
        id: dep.id,
        name: dep.name,
        maturityScore: dep.completeness ? Number(dep.completeness) : null,
        completeness: dep.completeness ? Number(dep.completeness) : null,
        children: dep.roles.map((r) => ({
          id: r.id,
          name: r.name,
          maturityScore: r.maturityScore ? Number(r.maturityScore) : null,
        })),
      };
    }
    const profile = await this.companyProfile.getRaw(args.tenantId);
    const departments = await this.prisma.department.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      select: { id: true, name: true, completeness: true },
    });
    return {
      scope: 'company',
      id: profile?.id ?? args.tenantId,
      name: profile?.displayName ?? 'Компания',
      maturityScore: profile?.maturityScore ? Number(profile.maturityScore) : null,
      completeness: profile?.maturityScore ? Number(profile.maturityScore) : null,
      children: departments.map((d) => ({
        id: d.id,
        name: d.name,
        maturityScore: d.completeness ? Number(d.completeness) : null,
      })),
    };
  }

  private estimateRoleCompleteness(role: {
    missionStatement: string | null;
    responsibilityElements: { id: string }[];
    authorityBoundaries: { id: string }[];
    roleProfile?: { summaryCache: Prisma.JsonValue } | null;
  }): number {
    const cache = role.roleProfile?.summaryCache;
    if (cache && typeof cache === 'object' && !Array.isArray(cache)) {
      const metrics = (cache as Record<string, unknown>).metrics;
      if (metrics && typeof metrics === 'object' && !Array.isArray(metrics)) {
        const m = (metrics as Record<string, unknown>).completeness;
        if (typeof m === 'number' && m >= 0 && m <= 1) return m;
      }
    }
    let v = 0;
    if (role.missionStatement && role.missionStatement.trim().length > 0) v += 0.2;
    if (role.responsibilityElements.length > 0) v += 0.2;
    if (role.authorityBoundaries.length > 0) v += 0.2;
    return v;
  }

  private async computeProbeClosedRatio(tenantId: string): Promise<number> {
    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const [total, dispatched] = await Promise.all([
        this.prisma.probeEvent.count({
          where: { tenantId, createdAt: { gte: since } },
        }),
        this.prisma.probeEvent.count({
          where: {
            tenantId,
            createdAt: { gte: since },
            status: 'dispatched',
          },
        }),
      ]);
      if (total === 0) return 0.5;
      return Math.min(1, dispatched / total);
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'computeProbeClosedRatio: graceful fallback (модель ProbeEvent не готова)',
      );
      return 0.5;
    }
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
