import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma, ProcessTemplate, ProcessTemplateVersion } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateProcessTemplateBody,
  CreateProcessTemplateVersionBody,
  DecisionPointDto,
  ListProcessTemplatesQuery,
  ListProcessTemplatesResponse,
  ListProcessTemplateVersionsResponse,
  ProcessHandoffDto,
  ProcessTemplateDefinitionDto,
  ProcessTemplateDetailDto,
  ProcessTemplateListItemDto,
  ProcessTemplateStatusDto,
  ProcessTemplateVersionDto,
  UpdateProcessTemplateBody,
} from '../dto/processes.dto';

import { CrossFunctionalDetectorService } from './cross-functional-detector.service';
import { ProcessTemplateCompletenessService } from './process-template-completeness.service';

@Injectable()
export class ProcessTemplateService {
  private readonly logger = new Logger(ProcessTemplateService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProcessTemplateCompletenessService)
    private readonly completeness: ProcessTemplateCompletenessService,
    @Inject(CrossFunctionalDetectorService)
    private readonly crossFunctional: CrossFunctionalDetectorService,
  ) {}

  async list(args: {
    tenantId: string;
    query: ListProcessTemplatesQuery;
  }): Promise<ListProcessTemplatesResponse> {
    const q = args.query;
    const skip = (q.page - 1) * q.limit;
    const take = q.limit;

    const where: Prisma.ProcessTemplateWhereInput = {
      tenantId: args.tenantId,
      deletedAt: null,
    };
    if (q.status) {
      where.status = q.status as Prisma.ProcessTemplateWhereInput['status'];
    }
    if (q.category) {
      where.category = q.category;
    }
    if (q.ownerEntityId) {
      where.OR = [{ ownerRoleId: q.ownerEntityId }, { ownerPersonId: q.ownerEntityId }];
    }
    if (q.q) {
      const contains = q.q;
      const filters: Prisma.ProcessTemplateWhereInput[] = [
        { name: { contains, mode: 'insensitive' } },
        { summary: { contains, mode: 'insensitive' } },
      ];
      where.AND = [...(where.AND ? this.normalizeAnd(where.AND) : []), { OR: filters }];
    }

    const [rows, total] = await Promise.all([
      this.prisma.processTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.processTemplate.count({ where }),
    ]);

    const ids = rows.map((r) => r.id);
    const [dpCounts, handoffCounts, currentVersionsMap] = await Promise.all([
      this.groupCountByTemplateId({
        tenantId: args.tenantId,
        table: 'decisionPoint',
        ids,
      }),
      this.groupCountHandoffsByTemplateId({
        tenantId: args.tenantId,
        ids,
      }),
      this.loadCurrentVersionsMap({
        ids: rows.map((r) => r.currentVersionId).filter((x): x is string => !!x),
      }),
    ]);

    let items: ProcessTemplateListItemDto[] = rows.map((r) => {
      const cv = r.currentVersionId ? (currentVersionsMap.get(r.currentVersionId) ?? null) : null;
      const definition = this.safeDefinition(cv?.definitionJson);
      return this.toListItem({
        template: r,
        stepsCount: definition?.steps.length ?? 0,
        decisionPointsCount: dpCounts.get(r.id) ?? 0,
        handoffsCount: handoffCounts.get(r.id) ?? 0,
      });
    });

    if (q.completenessMin != null) {
      items = items.filter((it) => it.completeness >= (q.completenessMin ?? 0));
    }

    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
  }

  async create(args: {
    tenantId: string;
    body: CreateProcessTemplateBody;
  }): Promise<ProcessTemplateDetailDto> {
    const dup = await this.prisma.processTemplate.findFirst({
      where: {
        tenantId: args.tenantId,
        name: args.body.name,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (dup) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'duplicate_name',
          message: `Шаблон процесса с именем «${args.body.name}» уже существует.`,
        },
      });
    }
    const created = await this.prisma.processTemplate.create({
      data: {
        tenantId: args.tenantId,
        name: args.body.name,
        summary: args.body.summary ?? null,
        category: args.body.category ?? null,
        scope: args.body.scope ?? null,
        ownerRoleId: args.body.ownerRoleId ?? null,
        ownerPersonId: args.body.ownerPersonId ?? null,
        sourceBlockIds: [],
        status: 'active',
        dataClass: 'internal',
      },
    });
    await this.completeness.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: created.id,
    });
    await this.crossFunctional.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: created.id,
    });
    return this.detail({ tenantId: args.tenantId, id: created.id });
  }

  async detail(args: { tenantId: string; id: string }): Promise<ProcessTemplateDetailDto> {
    const t = await this.prisma.processTemplate.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
    });
    if (!t) throw this.notFound(args.id);

    const [currentVersion, decisionPoints, handoffsFrom, handoffsTo] = await Promise.all([
      t.currentVersionId
        ? this.prisma.processTemplateVersion.findUnique({
            where: { id: t.currentVersionId },
          })
        : Promise.resolve(null),
      this.prisma.decisionPoint.findMany({
        where: { tenantId: args.tenantId, templateId: t.id },
        orderBy: { order: 'asc' },
      }),
      this.prisma.processHandoff.findMany({
        where: { tenantId: args.tenantId, fromTemplateId: t.id },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.processHandoff.findMany({
        where: { tenantId: args.tenantId, toTemplateId: t.id },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const definition = this.safeDefinition(currentVersion?.definitionJson);
    const list = this.toListItem({
      template: t,
      stepsCount: definition?.steps.length ?? 0,
      decisionPointsCount: decisionPoints.length,
      handoffsCount: handoffsFrom.length + handoffsTo.length,
    });

    return {
      ...list,
      sourceBlockIds: t.sourceBlockIds,
      currentVersion: currentVersion ? this.toVersionDto(currentVersion) : null,
      decisionPoints: decisionPoints.map((dp) => this.toDecisionPointDto(dp)),
      handoffsFrom: handoffsFrom.map((h) => this.toHandoffDto(h)),
      handoffsTo: handoffsTo.map((h) => this.toHandoffDto(h)),
    };
  }

  async update(args: {
    tenantId: string;
    id: string;
    body: UpdateProcessTemplateBody;
  }): Promise<ProcessTemplateDetailDto> {
    const existing = await this.prisma.processTemplate.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw this.notFound(args.id);

    const data: Prisma.ProcessTemplateUpdateInput = {};
    if (args.body.name !== undefined) data.name = args.body.name;
    if (args.body.summary !== undefined) data.summary = args.body.summary;
    if (args.body.category !== undefined) data.category = args.body.category;
    if (args.body.scope !== undefined) data.scope = args.body.scope;
    if (args.body.ownerRoleId !== undefined) {
      data.ownerRole = args.body.ownerRoleId
        ? { connect: { id: args.body.ownerRoleId } }
        : { disconnect: true };
    }
    if (args.body.ownerPersonId !== undefined) {
      data.ownerPerson = args.body.ownerPersonId
        ? { connect: { id: args.body.ownerPersonId } }
        : { disconnect: true };
    }
    if (args.body.status !== undefined) {
      data.status = args.body.status as Prisma.ProcessTemplateUpdateInput['status'];
    }

    await this.prisma.processTemplate.update({
      where: { id: args.id },
      data,
    });
    await this.completeness.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: args.id,
    });
    await this.crossFunctional.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: args.id,
    });
    return this.detail({ tenantId: args.tenantId, id: args.id });
  }

  async softDelete(args: { tenantId: string; id: string }): Promise<{ ok: true }> {
    const existing = await this.prisma.processTemplate.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw this.notFound(args.id);
    await this.prisma.processTemplate.update({
      where: { id: args.id },
      data: { status: 'archived', deletedAt: new Date() },
    });
    return { ok: true };
  }

  async listVersions(args: {
    tenantId: string;
    id: string;
  }): Promise<ListProcessTemplateVersionsResponse> {
    const t = await this.prisma.processTemplate.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!t) throw this.notFound(args.id);
    const items = await this.prisma.processTemplateVersion.findMany({
      where: { templateId: args.id, tenantId: args.tenantId },
      orderBy: { version: 'desc' },
    });
    return { items: items.map((v) => this.toVersionDto(v)) };
  }

  async createVersion(args: {
    tenantId: string;
    id: string;
    body: CreateProcessTemplateVersionBody;
    publishedByUserId: string | null;
  }): Promise<ProcessTemplateVersionDto> {
    const t = await this.prisma.processTemplate.findFirst({
      where: { id: args.id, tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!t) throw this.notFound(args.id);

    const lastVersion = await this.prisma.processTemplateVersion.findFirst({
      where: { templateId: args.id, tenantId: args.tenantId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (lastVersion?.version ?? 0) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      const version = await tx.processTemplateVersion.create({
        data: {
          tenantId: args.tenantId,
          templateId: args.id,
          version: nextVersion,
          definitionJson: args.body.definition as unknown as Prisma.InputJsonValue,
          source: args.body.source,
          changeNote: args.body.changeNote ?? null,
          publishedById: args.body.activateImmediately ? args.publishedByUserId : null,
          publishedAt: args.body.activateImmediately ? new Date() : null,
        },
      });
      if (args.body.activateImmediately) {
        await tx.processTemplate.update({
          where: { id: args.id },
          data: { currentVersionId: version.id },
        });
      }
      return version;
    });

    await this.completeness.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: args.id,
    });
    await this.crossFunctional.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: args.id,
    });
    return this.toVersionDto(created);
  }

  async activateVersion(args: {
    tenantId: string;
    id: string;
    versionId: string;
    publishedByUserId: string | null;
  }): Promise<ProcessTemplateVersionDto> {
    const version = await this.prisma.processTemplateVersion.findFirst({
      where: {
        id: args.versionId,
        tenantId: args.tenantId,
        templateId: args.id,
      },
    });
    if (!version) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'version_not_found',
          message: 'Версия шаблона не найдена.',
        },
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const v = await tx.processTemplateVersion.update({
        where: { id: args.versionId },
        data: {
          publishedById: args.publishedByUserId ?? version.publishedById,
          publishedAt: version.publishedAt ?? new Date(),
        },
      });
      await tx.processTemplate.update({
        where: { id: args.id },
        data: { currentVersionId: args.versionId },
      });
      return v;
    });
    await this.completeness.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: args.id,
    });
    await this.crossFunctional.recalculateAndPersist({
      tenantId: args.tenantId,
      templateId: args.id,
    });
    return this.toVersionDto(updated);
  }

  private toListItem(args: {
    template: ProcessTemplate;
    stepsCount: number;
    decisionPointsCount: number;
    handoffsCount: number;
  }): ProcessTemplateListItemDto {
    const completeness = this.completeness.extractCompleteness(args.template.metadata);
    return {
      id: args.template.id,
      name: args.template.name,
      summary: args.template.summary,
      category: args.template.category,
      scope: args.template.scope,
      status: this.statusToDto(args.template.status as string),
      currentVersionId: args.template.currentVersionId,
      ownerRoleId: args.template.ownerRoleId,
      ownerPersonId: args.template.ownerPersonId,
      completeness,
      stepsCount: args.stepsCount,
      decisionPointsCount: args.decisionPointsCount,
      handoffsCount: args.handoffsCount,
      lastConfirmedAt: args.template.lastConfirmedAt
        ? args.template.lastConfirmedAt.toISOString()
        : null,
      updatedAt: args.template.updatedAt.toISOString(),
      createdAt: args.template.createdAt.toISOString(),
    };
  }

  private toVersionDto(v: ProcessTemplateVersion): ProcessTemplateVersionDto {
    const def = this.safeDefinition(v.definitionJson) ?? {
      steps: [],
      handoffsInline: [],
      decisionPointsInline: [],
    };
    return {
      id: v.id,
      version: v.version,
      definition: def,
      source: this.versionSourceToDto(v.source),
      changeNote: v.changeNote,
      publishedById: v.publishedById,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      createdAt: v.createdAt.toISOString(),
    };
  }

  private toDecisionPointDto(dp: {
    id: string;
    templateId: string | null;
    name: string;
    condition: string | null;
    branchesJson: Prisma.JsonValue;
    decidedByRoleId: string | null;
    order: number;
    createdAt: Date;
    updatedAt: Date;
  }): DecisionPointDto {
    return {
      id: dp.id,
      templateId: dp.templateId,
      name: dp.name,
      condition: dp.condition,
      branches: Array.isArray(dp.branchesJson)
        ? (dp.branchesJson as Array<{
            name: string;
            description?: string;
            leadsToStepOrder?: number;
          }>)
        : [],
      decidedByRoleId: dp.decidedByRoleId,
      order: dp.order,
      createdAt: dp.createdAt.toISOString(),
      updatedAt: dp.updatedAt.toISOString(),
    };
  }

  private toHandoffDto(h: {
    id: string;
    fromTemplateId: string | null;
    toTemplateId: string | null;
    fromRoleId: string | null;
    toRoleId: string | null;
    kind: string;
    payloadDescription: string | null;
    expectedSlaHours: number | null;
    knownFrictionCount: number;
    createdAt: Date;
    updatedAt: Date;
  }): ProcessHandoffDto {
    return {
      id: h.id,
      fromTemplateId: h.fromTemplateId,
      toTemplateId: h.toTemplateId,
      fromRoleId: h.fromRoleId,
      toRoleId: h.toRoleId,
      kind: this.handoffKindToDto(h.kind),
      payloadDescription: h.payloadDescription,
      expectedSlaHours: h.expectedSlaHours,
      knownFrictionCount: h.knownFrictionCount,
      createdAt: h.createdAt.toISOString(),
      updatedAt: h.updatedAt.toISOString(),
    };
  }

  private safeDefinition(value: unknown): ProcessTemplateDefinitionDto | null {
    if (!value || typeof value !== 'object') return null;
    const rec = value as Record<string, unknown>;
    const steps = Array.isArray(rec.steps)
      ? (rec.steps as ProcessTemplateDefinitionDto['steps'])
      : [];
    const handoffsInline = Array.isArray(rec.handoffsInline)
      ? (rec.handoffsInline as ProcessTemplateDefinitionDto['handoffsInline'])
      : [];
    const decisionPointsInline = Array.isArray(rec.decisionPointsInline)
      ? (rec.decisionPointsInline as ProcessTemplateDefinitionDto['decisionPointsInline'])
      : [];
    return { steps, handoffsInline, decisionPointsInline };
  }

  private statusToDto(status: string): ProcessTemplateStatusDto {
    if (status === 'active' || status === 'deprecated' || status === 'archived') {
      return status;
    }
    return 'active';
  }

  private versionSourceToDto(source: string): ProcessTemplateVersionDto['source'] {
    if (source === 'manual' || source === 'agent' || source === 'imported') {
      return source;
    }
    return 'manual';
  }

  private handoffKindToDto(kind: string): ProcessHandoffDto['kind'] {
    if (
      kind === 'document' ||
      kind === 'data' ||
      kind === 'decision' ||
      kind === 'physical' ||
      kind === 'notification'
    ) {
      return kind;
    }
    return 'data';
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException({
      ok: false,
      error: {
        code: 'process_template_not_found',
        message: `Шаблон процесса ${id} не найден.`,
      },
    });
  }

  private normalizeAnd(
    and: Prisma.ProcessTemplateWhereInput | Prisma.ProcessTemplateWhereInput[],
  ): Prisma.ProcessTemplateWhereInput[] {
    return Array.isArray(and) ? and : [and];
  }

  private async groupCountByTemplateId(args: {
    tenantId: string;
    table: 'decisionPoint';
    ids: readonly string[];
  }): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (args.ids.length === 0) return result;
    const rows = await this.prisma.decisionPoint.groupBy({
      by: ['templateId'],
      where: {
        tenantId: args.tenantId,
        templateId: { in: args.ids as string[] },
      },
      _count: { _all: true },
    });
    for (const r of rows) {
      if (r.templateId) result.set(r.templateId, r._count._all);
    }
    return result;
  }

  private async groupCountHandoffsByTemplateId(args: {
    tenantId: string;
    ids: readonly string[];
  }): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (args.ids.length === 0) return result;
    const idArr = args.ids as string[];
    const [from, to] = await Promise.all([
      this.prisma.processHandoff.groupBy({
        by: ['fromTemplateId'],
        where: { tenantId: args.tenantId, fromTemplateId: { in: idArr } },
        _count: { _all: true },
      }),
      this.prisma.processHandoff.groupBy({
        by: ['toTemplateId'],
        where: { tenantId: args.tenantId, toTemplateId: { in: idArr } },
        _count: { _all: true },
      }),
    ]);
    for (const r of from) {
      if (r.fromTemplateId) {
        result.set(r.fromTemplateId, (result.get(r.fromTemplateId) ?? 0) + r._count._all);
      }
    }
    for (const r of to) {
      if (r.toTemplateId) {
        result.set(r.toTemplateId, (result.get(r.toTemplateId) ?? 0) + r._count._all);
      }
    }
    return result;
  }

  private async loadCurrentVersionsMap(args: {
    ids: readonly string[];
  }): Promise<Map<string, ProcessTemplateVersion>> {
    const map = new Map<string, ProcessTemplateVersion>();
    if (args.ids.length === 0) return map;
    const rows = await this.prisma.processTemplateVersion.findMany({
      where: { id: { in: args.ids as string[] } },
    });
    for (const r of rows) map.set(r.id, r);
    return map;
  }
}
