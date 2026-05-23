import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { RoleMapDto, RoleMaturityDto } from '../dto/role-map.dto';
import { resolveRoleMapTenantTop } from '../utils/tenant-top';

import { AuthorityBoundaryService } from './authority-boundary.service';
import { DecisionPolicyService } from './decision-policy.service';
import { InteractionService } from './interaction.service';
import { RequiredKnowledgeService } from './required-knowledge.service';
import { ResponsibilityElementService } from './responsibility-element.service';

/**
 * SBA α-8 wave 4 — `RoleMapBuilderService` — высокоуровневый агрегатор.
 *
 *   - `getMap(roleId)` — собирает все 5 wave-2 категорий + KPI + completeness +
 *     maturityScore в один IRoleMap для UI.
 *   - `getMaturity(roleId)` — детализация maturity (для drill-down).
 *   - `recomputeCompleteness({tenantId, roleId})` — пересчёт completeness и
 *     запись в `RoleProfile.completeness` (используется cron'ом и worker'ом).
 *
 * Бизнес-правила:
 *   - Completeness = взвешенное «есть/нет» по 5 нормализованным слотам +
 *     mission + at least 1 KPI metric + summaryCache + builtAt.
 *   - 9 слотов поровну (0.111 каждый). Округляем до 0.001.
 *   - Если RoleProfile.completeness уже выставлен билдером — используем его,
 *     иначе считаем эвристикой.
 */
@Injectable()
export class RoleMapBuilderService {
  private readonly logger = new Logger(RoleMapBuilderService.name);

  /** 9 слотов Role Map (см. ТЗ §3.3). */
  static readonly SLOTS = [
    'mission',
    'responsibilities',
    'authority',
    'knowledge',
    'decisions',
    'interactions',
    'metrics',
    'summary',
    'built',
  ] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ResponsibilityElementService)
    private readonly responsibilities: ResponsibilityElementService,
    @Inject(AuthorityBoundaryService)
    private readonly authority: AuthorityBoundaryService,
    @Inject(RequiredKnowledgeService)
    private readonly knowledge: RequiredKnowledgeService,
    @Inject(DecisionPolicyService)
    private readonly decisions: DecisionPolicyService,
    @Inject(InteractionService)
    private readonly interactions: InteractionService,
  ) {}

  /**
   * Главный метод: собирает RoleMapDto для UI.
   *
   * Намеренно делаем отдельные findUnique / findMany вместо одного include —
   * на агрегированной схеме Prisma's `include`-narrowing порой триггерит
   * каскадный TS2589 в этом проекте (см. env.schema.ts NB).
   */
  async getMap(args: {
    tenantId: string;
    roleId: string;
  }): Promise<RoleMapDto> {
    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
    });
    if (!role || role.tenantId !== args.tenantId || role.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Должность не найдена' },
      });
    }

    const [
      department,
      roleProfile,
      attachedMetrics,
      responsibilities,
      authority,
      knowledge,
      decisions,
      interactions,
    ] = await Promise.all([
      role.departmentId
        ? this.prisma.department.findUnique({
            where: { id: role.departmentId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      this.prisma.roleProfile.findUnique({
        where: { roleId: args.roleId },
        select: {
          summaryCache: true,
          completeness: true,
          builtAt: true,
          status: true,
        },
      }),
      this.prisma.metric.findMany({
        where: { tenantId: args.tenantId, attachedToRoleId: args.roleId },
        select: {
          id: true,
          name: true,
          unit: true,
          target: true,
          currentValue: true,
        },
        take: 50,
      }),
      this.responsibilities.listByRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      }),
      this.authority.listByRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      }),
      this.knowledge.listByRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      }),
      this.decisions.listByRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      }),
      this.interactions.listByRole({
        tenantId: args.tenantId,
        roleId: args.roleId,
      }),
    ]);

    const counts = {
      responsibilities: responsibilities.length,
      authority: authority.length,
      knowledge: knowledge.length,
      decisions: decisions.length,
      interactions: interactions.length,
      metrics: attachedMetrics.length,
    };

    const completenessCache = roleProfile?.completeness ?? null;
    const completeness =
      completenessCache !== null
        ? Number(completenessCache)
        : this.estimateCompleteness({
            missionStatement: role.missionStatement,
            counts,
            summaryCache: roleProfile?.summaryCache,
            builtAt: roleProfile?.builtAt ?? null,
          });

    return {
      role: {
        id: role.id,
        name: role.name,
        departmentId: role.departmentId,
        departmentName: department?.name ?? null,
        missionStatement: role.missionStatement,
      },
      responsibilities,
      authority,
      knowledge,
      decisions,
      interactions,
      metrics: attachedMetrics.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        targetValue: m.target === null ? null : Number(m.target),
        currentValue: m.currentValue === null ? null : Number(m.currentValue),
      })),
      completeness: Math.round(completeness * 1000) / 1000,
      maturityScore:
        role.maturityScore === null ? null : Number(role.maturityScore),
      counts,
      summaryCache: roleProfile?.summaryCache ?? null,
      builtAt: roleProfile?.builtAt
        ? roleProfile.builtAt.toISOString()
        : null,
      isForming: !roleProfile || roleProfile.status === 'forming',
    };
  }

  /**
   * Детализация maturity (для tooltip / drill-down).
   */
  async getMaturity(args: {
    tenantId: string;
    roleId: string;
    rationale?: string | null;
  }): Promise<RoleMaturityDto> {
    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        maturityScore: true,
        missionStatement: true,
        deletedAt: true,
      },
    });
    if (!role || role.tenantId !== args.tenantId || role.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'role_not_found', message: 'Должность не найдена' },
      });
    }

    const [
      respCount,
      authCount,
      knowCount,
      decCount,
      interCount,
      metricCount,
      profile,
    ] = await Promise.all([
      this.prisma.responsibilityElement.count({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          deletedAt: null,
        },
      }),
      this.prisma.authorityBoundary.count({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          deletedAt: null,
        },
      }),
      this.prisma.requiredKnowledge.count({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          deletedAt: null,
        },
      }),
      this.prisma.decisionPolicy.count({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          deletedAt: null,
        },
      }),
      this.prisma.interaction.count({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          deletedAt: null,
        },
      }),
      this.prisma.metric.count({
        where: { tenantId: args.tenantId, attachedToRoleId: args.roleId },
      }),
      this.prisma.roleProfile.findUnique({
        where: { roleId: args.roleId },
        select: {
          completeness: true,
          summaryCache: true,
          builtAt: true,
        },
      }),
    ]);

    const counts = {
      responsibilities: respCount,
      authority: authCount,
      knowledge: knowCount,
      decisions: decCount,
      interactions: interCount,
      metrics: metricCount,
    };

    const completeness =
      profile?.completeness !== undefined && profile?.completeness !== null
        ? Number(profile.completeness)
        : this.estimateCompleteness({
            missionStatement: role.missionStatement,
            counts,
            summaryCache: profile?.summaryCache,
            builtAt: profile?.builtAt ?? null,
          });

    return {
      roleId: role.id,
      roleName: role.name,
      maturityScore:
        role.maturityScore === null ? null : Number(role.maturityScore),
      completeness: Math.round(completeness * 1000) / 1000,
      rationale: args.rationale ?? null,
      contributingFactors: [
        { label: 'Миссия должности', value: role.missionStatement ? 1 : 0, weight: 1 / 9 },
        { label: 'Обязанности', value: bool(respCount), weight: 1 / 9 },
        { label: 'Границы полномочий', value: bool(authCount), weight: 1 / 9 },
        { label: 'Требуемые знания', value: bool(knowCount), weight: 1 / 9 },
        { label: 'Политики решений', value: bool(decCount), weight: 1 / 9 },
        { label: 'Взаимодействия', value: bool(interCount), weight: 1 / 9 },
        { label: 'KPI / метрики', value: bool(metricCount), weight: 1 / 9 },
        {
          label: 'Summary (быстрый кеш)',
          value: hasSummary(profile?.summaryCache) ? 1 : 0,
          weight: 1 / 9,
        },
        {
          label: 'Сборка билдером',
          value: profile?.builtAt ? 1 : 0,
          weight: 1 / 9,
        },
      ],
      perCategory: counts,
    };
  }

  /**
   * Пересчёт completeness для одной роли. Записывает в RoleProfile.completeness.
   * Не трогает Role.maturityScore (это делает MaturityScorerCron).
   */
  async recomputeCompleteness(args: {
    tenantId: string;
    roleId: string;
  }): Promise<{ completeness: number; written: boolean }> {
    const [role, profile, counts] = await Promise.all([
      this.prisma.role.findUnique({
        where: { id: args.roleId },
        select: { tenantId: true, missionStatement: true, deletedAt: true },
      }),
      this.prisma.roleProfile.findUnique({
        where: { roleId: args.roleId },
        select: {
          id: true,
          completeness: true,
          summaryCache: true,
          builtAt: true,
        },
      }),
      this.countSlots(args.tenantId, args.roleId),
    ]);
    if (!role || role.tenantId !== args.tenantId || role.deletedAt) {
      return { completeness: 0, written: false };
    }
    const completeness = this.estimateCompleteness({
      missionStatement: role.missionStatement,
      counts,
      summaryCache: profile?.summaryCache,
      builtAt: profile?.builtAt ?? null,
    });
    if (!profile) {
      // RoleProfile создаётся при создании Role (см. RolesDomainService);
      // если нет — best-effort skip.
      return { completeness, written: false };
    }
    const prev = profile.completeness === null ? null : Number(profile.completeness);
    if (prev === null || Math.abs(prev - completeness) >= 0.001) {
      await this.prisma.roleProfile.update({
        where: { id: profile.id },
        data: { completeness: new Prisma.Decimal(completeness) },
      });
      return { completeness, written: true };
    }
    return { completeness, written: false };
  }

  /**
   * Полный проход по всем активным Role в Org. Используется cron'ом.
   * Параллельно обновляет gauge `role_map_completeness_avg`.
   */
  async recomputeAllForTenant(args: {
    tenantId: string;
  }): Promise<{
    rolesScanned: number;
    rolesUpdated: number;
    avgCompleteness: number | null;
    rolesWithNormalizedData: number;
  }> {
    const roles = await this.prisma.role.findMany({
      where: { tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    let updated = 0;
    let sumCompleteness = 0;
    let withData = 0;
    for (const r of roles) {
      const res = await this.recomputeCompleteness({
        tenantId: args.tenantId,
        roleId: r.id,
      });
      sumCompleteness += res.completeness;
      if (res.written) updated++;
      if (res.completeness >= 0.55) withData++;
    }
    const avg = roles.length > 0 ? sumCompleteness / roles.length : null;
    const ratio = roles.length > 0 ? withData / roles.length : 0;
    const tenantTop = resolveRoleMapTenantTop(args.tenantId);
    if (avg !== null) {
      this.metrics.setRoleMapCompletenessAvg({ tenantTop, value: avg });
    }
    this.metrics.setRolesWithNormalizedDataRatio({ tenantTop, value: ratio });
    return {
      rolesScanned: roles.length,
      rolesUpdated: updated,
      avgCompleteness: avg,
      rolesWithNormalizedData: withData,
    };
  }

  // ─────────────────────────── internal ─────────────────────────────

  private async countSlots(
    tenantId: string,
    roleId: string,
  ): Promise<{
    responsibilities: number;
    authority: number;
    knowledge: number;
    decisions: number;
    interactions: number;
    metrics: number;
  }> {
    const [resp, auth, kn, dec, inter, metr] = await Promise.all([
      this.prisma.responsibilityElement.count({
        where: { tenantId, roleId, deletedAt: null },
      }),
      this.prisma.authorityBoundary.count({
        where: { tenantId, roleId, deletedAt: null },
      }),
      this.prisma.requiredKnowledge.count({
        where: { tenantId, roleId, deletedAt: null },
      }),
      this.prisma.decisionPolicy.count({
        where: { tenantId, roleId, deletedAt: null },
      }),
      this.prisma.interaction.count({
        where: { tenantId, roleId, deletedAt: null },
      }),
      this.prisma.metric.count({
        where: { tenantId, attachedToRoleId: roleId },
      }),
    ]);
    return {
      responsibilities: resp,
      authority: auth,
      knowledge: kn,
      decisions: dec,
      interactions: inter,
      metrics: metr,
    };
  }

  private estimateCompleteness(args: {
    missionStatement: string | null;
    counts: {
      responsibilities: number;
      authority: number;
      knowledge: number;
      decisions: number;
      interactions: number;
      metrics: number;
    };
    summaryCache: Prisma.JsonValue | null | undefined;
    builtAt: Date | null;
  }): number {
    const weight = 1 / 9;
    let total = 0;
    if (args.missionStatement && args.missionStatement.trim().length > 0) {
      total += weight;
    }
    if (args.counts.responsibilities > 0) total += weight;
    if (args.counts.authority > 0) total += weight;
    if (args.counts.knowledge > 0) total += weight;
    if (args.counts.decisions > 0) total += weight;
    if (args.counts.interactions > 0) total += weight;
    if (args.counts.metrics > 0) total += weight;
    if (hasSummary(args.summaryCache)) total += weight;
    if (args.builtAt) total += weight;
    return Math.max(0, Math.min(1, total));
  }
}

function bool(n: number): number {
  return n > 0 ? 1 : 0;
}

function hasSummary(cache: Prisma.JsonValue | null | undefined): boolean {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return false;
  const obj = cache as Record<string, unknown>;
  return Object.keys(obj).length > 0;
}
