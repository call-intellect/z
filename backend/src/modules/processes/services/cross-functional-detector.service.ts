import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProcessTemplateDefinitionDto } from '../dto/processes.dto';

import { resolveProcessTenantTop } from './tenant-top';

@Injectable()
export class CrossFunctionalDetectorService {
  private readonly logger = new Logger(CrossFunctionalDetectorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  compute(args: {
    steps: ReadonlyArray<{ ownerRoleId?: string | null }>;
    roleToDepartment: ReadonlyMap<string, string | null>;
    threshold: number;
  }): {
    score: number;
    isCrossFunctional: boolean;
    uniqueDepartments: number;
    totalSteps: number;
  } {
    const totalSteps = args.steps.length;
    if (totalSteps === 0) {
      return {
        score: 0,
        isCrossFunctional: false,
        uniqueDepartments: 0,
        totalSteps: 0,
      };
    }
    const deptSet = new Set<string>();
    for (const s of args.steps) {
      if (!s.ownerRoleId) continue;
      const dept = args.roleToDepartment.get(s.ownerRoleId);
      if (dept) deptSet.add(dept);
    }
    const uniqueDepartments = deptSet.size;
    const raw = uniqueDepartments / totalSteps;
    const score = Math.max(0, Math.min(1, Number(raw.toFixed(3))));
    return {
      score,
      isCrossFunctional: score >= args.threshold,
      uniqueDepartments,
      totalSteps,
    };
  }

  async recalculateAndPersist(args: { tenantId: string; templateId: string }): Promise<{
    score: number;
    isCrossFunctional: boolean;
    uniqueDepartments: number;
    totalSteps: number;
    skipped: boolean;
  }> {
    if (!this.cfg.processTemplate.crossFunctionalDetectorEnabled) {
      return {
        score: 0,
        isCrossFunctional: false,
        uniqueDepartments: 0,
        totalSteps: 0,
        skipped: true,
      };
    }
    try {
      const template = await this.prisma.processTemplate.findFirst({
        where: { id: args.templateId, tenantId: args.tenantId },
        select: { id: true, currentVersionId: true, isCrossFunctional: true },
      });
      if (!template) {
        return {
          score: 0,
          isCrossFunctional: false,
          uniqueDepartments: 0,
          totalSteps: 0,
          skipped: true,
        };
      }

      const definition = template.currentVersionId
        ? await this.loadDefinition(template.currentVersionId)
        : null;
      const steps = definition?.steps ?? [];

      const roleIds = Array.from(
        new Set(
          steps
            .map((s) => s.ownerRoleId)
            .filter((x): x is string => typeof x === 'string' && x.length > 0),
        ),
      );

      const roleToDepartment = new Map<string, string | null>();
      if (roleIds.length > 0) {
        const roles = await this.prisma.role.findMany({
          where: { id: { in: roleIds }, tenantId: args.tenantId },
          select: { id: true, departmentId: true },
        });
        for (const r of roles) {
          roleToDepartment.set(r.id, r.departmentId);
        }
      }

      const result = this.compute({
        steps,
        roleToDepartment,
        threshold: this.cfg.processTemplate.crossFunctionalScoreThreshold,
      });

      await this.prisma.processTemplate.update({
        where: { id: args.templateId },
        data: {
          isCrossFunctional: result.isCrossFunctional,
          crossFunctionalScore: new Prisma.Decimal(result.score.toFixed(3)),
        },
      });

      return { ...result, skipped: false };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          templateId: args.templateId,
          tenantTop: resolveProcessTenantTop(args.tenantId),
          err: err instanceof Error ? err.message : String(err),
        },
        'cross-functional-detector: recalc упал (best-effort)',
      );
      return {
        score: 0,
        isCrossFunctional: false,
        uniqueDepartments: 0,
        totalSteps: 0,
        skipped: true,
      };
    }
  }

  private async loadDefinition(versionId: string): Promise<ProcessTemplateDefinitionDto | null> {
    const v = await this.prisma.processTemplateVersion.findUnique({
      where: { id: versionId },
      select: { definitionJson: true },
    });
    if (!v) return null;
    return this.safeDefinition(v.definitionJson);
  }

  private safeDefinition(value: unknown): ProcessTemplateDefinitionDto | null {
    if (!value || typeof value !== 'object') return null;
    const rec = value as Record<string, unknown>;
    const rawSteps = Array.isArray(rec.steps) ? rec.steps : [];
    const steps = rawSteps
      .map((s) => this.coerceStep(s))
      .filter((s): s is NonNullable<ReturnType<typeof this.coerceStep>> => !!s);
    return { steps, handoffsInline: [], decisionPointsInline: [] };
  }

  private coerceStep(s: unknown): {
    name: string;
    order: number;
    ownerRoleId?: string;
  } | null {
    if (!s || typeof s !== 'object') return null;
    const r = s as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : null;
    const order = typeof r.order === 'number' ? r.order : null;
    if (!name || order == null) return null;
    return {
      name,
      order,
      ownerRoleId: typeof r.ownerRoleId === 'string' ? r.ownerRoleId : undefined,
    };
  }
}
