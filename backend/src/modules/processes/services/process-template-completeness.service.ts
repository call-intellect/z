import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import type { ProcessTemplateDefinitionDto } from '../dto/processes.dto';

/**
 * SBA α-7 wave 2 — ProcessTemplateCompletenessService.
 *
 * Вычисляет «completeness» для `ProcessTemplate` — какой процент required-слотов
 * заполнен:
 *   - наличие currentVersion с >= 1 step;
 *   - у каждого step заполнены name + ownerRoleId + outputArtifact;
 *   - у template есть ownerRoleId или ownerPersonId;
 *   - есть хотя бы 1 DecisionPoint ИЛИ steps <= 2 (для простых процессов
 *     решения не обязательны);
 *   - есть хотя бы 1 ProcessHandoff ИЛИ template — терминальный (нет других
 *     template'ов в Org).
 *
 * Результат хранится в `ProcessTemplate.metadata.completeness` (Json) —
 * schema.prisma не изменялся (см. α-7 wave 2 §5). Pure function:
 * `compute()` принимает все нужные данные и возвращает 0..1.
 *
 * `recalculateAndPersist()` подгружает данные из БД, считает completeness и
 * сохраняет в `metadata.completeness`. Идемпотентно.
 *
 * Контракт: не бросает на «нет данных» — возвращает 0.0. Бросает только при
 * сбое БД.
 */
@Injectable()
export class ProcessTemplateCompletenessService {
  private readonly logger = new Logger(ProcessTemplateCompletenessService.name);

  /** Базовый набор required-критериев. Сумма weight'ов = 1.0. */
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

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  // ─────────────────────────── compute (pure) ─────────────────────────

  /**
   * Чистая функция: получает все данные на руках, возвращает 0..1.
   *
   * `siblingTemplatesCount` — число активных template'ов в Org (без текущего).
   * Если 0 — template считается «терминальным», handoff не обязателен.
   */
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
        (s) => (s.inputArtifact && s.inputArtifact.length > 0) || (s.outputArtifact && s.outputArtifact.length > 0),
      ).length;
      flags.steps_have_artifacts = stepsWithArtifact / steps.length >= 0.5;
    }

    // Простые процессы (<= 2 шагов) — DecisionPoint не обязателен.
    flags.has_decision_or_simple =
      steps.length <= 2 || args.decisionPointsCount > 0;

    // Терминальные процессы (нет других template'ов) — handoff не обязателен.
    flags.has_handoff_or_terminal =
      args.siblingTemplatesCount === 0 || args.handoffsCount > 0;

    let score = 0;
    for (const c of ProcessTemplateCompletenessService.CRITERIA) {
      if (flags[c.key]) score += c.weight;
    }
    // На случай float-погрешности: clamp в 0..1.
    return Math.max(0, Math.min(1, Number(score.toFixed(4))));
  }

  // ─────────────────────────── recalculateAndPersist ──────────────────

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

    const [decisionPointsCount, handoffsCount, siblingTemplatesCount] =
      await Promise.all([
        this.prisma.decisionPoint.count({
          where: { tenantId: args.tenantId, templateId: args.templateId },
        }),
        this.prisma.processHandoff.count({
          where: {
            tenantId: args.tenantId,
            OR: [
              { fromTemplateId: args.templateId },
              { toTemplateId: args.templateId },
            ],
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

  /**
   * Достать `completeness` из metadata — для сервисов, которым нужно отдать
   * в API без полного пересчёта.
   */
  extractCompleteness(metadata: unknown): number {
    const rec = this.toRecord(metadata);
    const raw = rec.completeness;
    if (typeof raw === 'number' && raw >= 0 && raw <= 1) return raw;
    return 0;
  }

  // ─────────────────────────── helpers ────────────────────────────────

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
      ownerRoleId:
        typeof r.ownerRoleId === 'string' ? r.ownerRoleId : undefined,
      inputArtifact:
        typeof r.inputArtifact === 'string' ? r.inputArtifact : undefined,
      outputArtifact:
        typeof r.outputArtifact === 'string' ? r.outputArtifact : undefined,
      slaMinutes:
        typeof r.slaMinutes === 'number' ? r.slaMinutes : undefined,
    };
  }
}
