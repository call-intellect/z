import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProcessTemplateDefinitionDto } from '../dto/processes.dto';

@Injectable()
export class ProcessTemplateCompletenessService {
  private readonly logger = new Logger(ProcessTemplateCompletenessService.name);

  private static readonly CRITERIA: ReadonlyArray<{
    key: string;
    weight: number;
  }> = [
    { key: 'has_current_version', weight: 0.2 },
    { key: 'has_owner', weight: 0.15 },
    { key: 'steps_have_owner', weight: 0.15 },
    { key: 'steps_have_artifacts', weight: 0.15 },
    { key: 'has_decision_or_simple', weight: 0.15 },
    { key: 'has_handoff_or_terminal', weight: 0.2 },
  ];

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  compute(args: {
    template: {
      ownerRoleId: string | null;
      ownerPersonId: string | null;
    };
    currentVersion: {
      definition: ProcessTemplateDefinitionDto | null;
    } | null;
    decisionPointsCount: number;
    handoffsCount: number;
    siblingTemplatesCount: number;
  }): number {
    const flags: Record<string, boolean> = {
      has_current_version: false,
      has_owner: false,
      steps_have_owner: false,
      steps_have_artifacts: false,
      has_decision_or_simple: false,
      has_handoff_or_terminal: false,
    };

    const steps = args.currentVersion?.definition?.steps ?? [];
    flags.has_current_version = !!args.currentVersion && steps.length > 0;
    flags.has_owner = !!(args.template.ownerRoleId || args.template.ownerPersonId);

    if (steps.length > 0) {
      const stepsWithOwner = steps.filter((s) => s.ownerRoleId).length;
      flags.steps_have_owner = stepsWithOwner / steps.length >= 0.5;
      const stepsWithArtifact = steps.filter(
        (s) =>
          (s.inputArtifact && s.inputArtifact.length > 0) ||
          (s.outputArtifact && s.outputArtifact.length > 0),
      ).length;
      flags.steps_have_artifacts = stepsWithArtifact / steps.length >= 0.5;
    }

    flags.has_decision_or_simple = steps.length <= 2 || args.decisionPointsCount > 0;

    flags.has_handoff_or_terminal = args.siblingTemplatesCount === 0 || args.handoffsCount > 0;

    let score = 0;
    for (const c of ProcessTemplateCompletenessService.CRITERIA) {
      if (flags[c.key]) score += c.weight;
    }
    return Math.max(0, Math.min(1, Number(score.toFixed(4))));
  }

  async recalculateAndPersist(args: {
    tenantId: string;
    templateId: string;
  }): Promise<{ completeness: number }> {
    const template = await this.prisma.processTemplate.findFirst({
      where: { id: args.templateId, tenantId: args.tenantId },
      select: {
        id: true,
        ownerRoleId: true,
        ownerPersonId: true,
        currentVersionId: true,
        metadata: true,
      },
    });
    if (!template) {
      return { completeness: 0 };
    }
    const currentVersion = template.currentVersionId
      ? await this.prisma.processTemplateVersion.findUnique({
          where: { id: template.currentVersionId },
          select: { definitionJson: true },
        })
      : null;

    const [decisionPointsCount, handoffsCount, siblingTemplatesCount] = await Promise.all([
      this.prisma.decisionPoint.count({
        where: { tenantId: args.tenantId, templateId: args.templateId },
      }),
      this.prisma.processHandoff.count({
        where: {
          tenantId: args.tenantId,
          OR: [{ fromTemplateId: args.templateId }, { toTemplateId: args.templateId }],
        },
      }),
      this.prisma.processTemplate.count({
        where: {
          tenantId: args.tenantId,
          status: 'active',
          deletedAt: null,
          id: { not: args.templateId },
        },
      }),
    ]);

    const completeness = this.compute({
      template: {
        ownerRoleId: template.ownerRoleId,
        ownerPersonId: template.ownerPersonId,
      },
      currentVersion: currentVersion
        ? {
            definition: this.safeDefinition(currentVersion.definitionJson),
          }
        : null,
      decisionPointsCount,
      handoffsCount,
      siblingTemplatesCount,
    });

    const prevMetadata = this.toRecord(template.metadata);
    const nextMetadata: Record<string, unknown> = {
      ...prevMetadata,
      completeness,
      completenessUpdatedAt: new Date().toISOString(),
    };

    await this.prisma.processTemplate.update({
      where: { id: args.templateId },
      data: {
        metadata: nextMetadata as Prisma.InputJsonValue,
      },
    });

    return { completeness };
  }

  extractCompleteness(metadata: unknown): number {
    const rec = this.toRecord(metadata);
    const raw = rec.completeness;
    if (typeof raw === 'number' && raw >= 0 && raw <= 1) return raw;
    return 0;
  }

  private toRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private safeDefinition(value: unknown): ProcessTemplateDefinitionDto | null {
    if (!value || typeof value !== 'object') return null;
    const rec = value as Record<string, unknown>;
    const rawSteps = Array.isArray(rec.steps) ? rec.steps : [];
    const steps = rawSteps
      .map((s) => this.coerceStep(s))
      .filter((s): s is NonNullable<ReturnType<typeof this.coerceStep>> => !!s);
    return {
      steps,
      handoffsInline: [],
      decisionPointsInline: [],
    };
  }

  private coerceStep(s: unknown): {
    name: string;
    order: number;
    description?: string;
    ownerRoleId?: string;
    inputArtifact?: string;
    outputArtifact?: string;
    slaMinutes?: number;
  } | null {
    if (!s || typeof s !== 'object') return null;
    const r = s as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name : null;
    const order = typeof r.order === 'number' ? r.order : null;
    if (!name || order == null) return null;
    return {
      name,
      order,
      description: typeof r.description === 'string' ? r.description : undefined,
      ownerRoleId: typeof r.ownerRoleId === 'string' ? r.ownerRoleId : undefined,
      inputArtifact: typeof r.inputArtifact === 'string' ? r.inputArtifact : undefined,
      outputArtifact: typeof r.outputArtifact === 'string' ? r.outputArtifact : undefined,
      slaMinutes: typeof r.slaMinutes === 'number' ? r.slaMinutes : undefined,
    };
  }
}
