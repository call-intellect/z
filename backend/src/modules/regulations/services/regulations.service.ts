import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CurationService } from '../../curation/services/curation.service';
import {
  type ProvenancePreviewRef,
  ProvenanceService,
  type ProvenanceSourceRef,
} from '../../knowledge-core/services/provenance.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import type {
  ConfirmRegulationBody,
  ListRegulationsQuery,
  ListRegulationsResponse,
  PolicySeverityDto,
  ProcessStepDto,
  RegulationDetailDto,
  RegulationHistoryResponse,
  RegulationKindDto,
  RegulationListItemDto,
  RegulationNeedsAttentionDto,
  RegulationSourcesResponse,
  RegulationSummaryResponse,
  SupersedeRegulationBody,
  TrustTierDto,
} from '../dto/regulations.dto';

export function computeRegulationNeedsAttention(args: {
  kind: RegulationKindDto;
  ownerPersonId: string | null;
  scope: string | null;
  severity?: PolicySeverityDto | null;
  steps?: Pick<ProcessStepDto, 'id'>[] | null;
}): RegulationNeedsAttentionDto {
  const missingOwner = args.ownerPersonId == null;
  const missingSteps =
    args.kind === 'process' && (args.steps == null || args.steps.length === 0);
  const scopeChecked = args.kind === 'regulation' || args.kind === 'policy';
  const policyScopeRelevant =
    args.kind !== 'policy' ||
    args.severity === 'mandatory' ||
    args.severity === 'blocking';
  const unclearScope = scopeChecked && policyScopeRelevant && args.scope == null;
  return { missingOwner, missingSteps, unclearScope };
}

@Injectable()
export class RegulationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly events: EventEmitter2 | null = null,
    @Optional()
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService | null = null,
    @Optional()
    @Inject(ProvenanceService)
    private readonly provenance: ProvenanceService | null = null,
  ) {}

  private async gateProjections<T extends { id: string; sourceBlockIds: string[] }>(
    items: T[],
    args: { tenantId: string; userId?: string },
  ): Promise<T[]> {
    const enf = this.cfg?.knowledgeAccess.enforcement ?? 'off';
    if (enf === 'off' || !this.accessResolver || !args.userId || items.length === 0) {
      return items;
    }
    const accessCtx = await this.accessResolver.resolveAccessibleGroups({
      tenantId: args.tenantId,
      userId: args.userId,
    });
    if (accessCtx.isBypass) return items;
    const { accessibleIds, denied } = await this.accessResolver.partitionProjectionsByAccess(
      accessCtx,
      items.map((i) => ({ id: i.id, sourceBlockIds: i.sourceBlockIds ?? [] })),
    );
    if (enf === 'enforce') {
      this.metrics?.incAccessDenied({ surface: 'regulations' }, denied);
      return items.filter((i) => accessibleIds.has(i.id));
    }
    this.metrics?.incAccessShadowDiff({ surface: 'regulations' }, denied);
    return items;
  }

  async list(args: {
    tenantId: string;
    userId?: string;
    query: ListRegulationsQuery;
  }): Promise<ListRegulationsResponse> {
    const q = args.query;
    const skip = (q.page - 1) * q.limit;
    const take = q.limit;

    if (q.kind === 'process') {
      return this.listProcesses({ ...args, skip, take });
    }
    if (q.kind === 'policy') {
      return this.listPolicies({ ...args, skip, take });
    }
    if (q.kind === 'instruction') {
      return this.listInstructions({ ...args, skip, take });
    }
    if (q.kind === 'regulation' || q.kind === 'standard') {
      return this.listRegulations({ ...args, skip, take, restrictCategory: q.kind });
    }

    const [regs, procs, pols, regsCount, procsCount, polsCount] = await Promise.all([
      this.prisma.regulation.findMany({
        where: this.regulationsWhere(args.tenantId, q),
        orderBy: { updatedAt: 'desc' },
        take: q.limit * q.page,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.process.findMany({
        where: this.processesWhere(args.tenantId, q),
        orderBy: { updatedAt: 'desc' },
        take: q.limit * q.page,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.policy.findMany({
        where: this.policiesWhere(args.tenantId, q),
        orderBy: { updatedAt: 'desc' },
        take: q.limit * q.page,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.regulation.count({
        where: this.regulationsWhere(args.tenantId, q),
      }),
      this.prisma.process.count({
        where: this.processesWhere(args.tenantId, q),
      }),
      this.prisma.policy.count({
        where: this.policiesWhere(args.tenantId, q),
      }),
    ]);

    const [visRegs, visProcs, visPols] = await Promise.all([
      this.gateProjections(regs, { tenantId: args.tenantId, userId: args.userId }),
      this.gateProjections(procs, { tenantId: args.tenantId, userId: args.userId }),
      this.gateProjections(pols, { tenantId: args.tenantId, userId: args.userId }),
    ]);
    const merged = [
      ...visRegs.map((r) => this.regulationToListItem(r, r.currentVersion?.trustTier ?? 'human')),
      ...visProcs.map((p) => this.processToListItem(p, p.currentVersion?.trustTier ?? 'human')),
      ...visPols.map((p) => this.policyToListItem(p, p.currentVersion?.trustTier ?? 'human')),
    ];
    merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const items = merged.slice(skip, skip + take);
    const total = regsCount + procsCount + polsCount;
    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
  }

  private async listRegulations(args: {
    tenantId: string;
    userId?: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
    restrictCategory: 'regulation' | 'standard';
  }): Promise<ListRegulationsResponse> {
    const where = {
      ...this.regulationsWhere(args.tenantId, args.query),
      category: args.restrictCategory,
    };
    const [items, total] = await Promise.all([
      this.prisma.regulation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.regulation.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
    });
    return {
      items: visible.map((r) =>
        this.regulationToListItem(r, r.currentVersion?.trustTier ?? 'human'),
      ),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  private async listProcesses(args: {
    tenantId: string;
    userId?: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
  }): Promise<ListRegulationsResponse> {
    const where = this.processesWhere(args.tenantId, args.query);
    const [items, total] = await Promise.all([
      this.prisma.process.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.process.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
    });
    return {
      items: visible.map((p) => this.processToListItem(p, p.currentVersion?.trustTier ?? 'human')),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  private async listPolicies(args: {
    tenantId: string;
    userId?: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
  }): Promise<ListRegulationsResponse> {
    const where = this.policiesWhere(args.tenantId, args.query);
    const [items, total] = await Promise.all([
      this.prisma.policy.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.policy.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
    });
    return {
      items: visible.map((p) => this.policyToListItem(p, p.currentVersion?.trustTier ?? 'human')),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  private async listInstructions(args: {
    tenantId: string;
    userId?: string;
    query: ListRegulationsQuery;
    skip: number;
    take: number;
  }): Promise<ListRegulationsResponse> {
    const where = this.instructionsWhere(args.tenantId, args.query);
    const [items, total] = await Promise.all([
      this.prisma.instruction.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: args.skip,
        take: args.take,
      }),
      this.prisma.instruction.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
    });
    return {
      items: visible.map((i) => this.instructionToListItem(i)),
      total,
      page: args.query.page,
      limit: args.query.limit,
      totalPages: Math.max(1, Math.ceil(total / args.query.limit)),
    };
  }

  async getByIdAndKind(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
  }): Promise<RegulationDetailDto> {
    if (args.kind === 'process') {
      const proc = await this.prisma.process.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        include: {
          steps: { orderBy: { order: 'asc' } },
          currentVersion: { select: { trustTier: true } },
        },
      });
      if (!proc) this.notFound(args.kind, args.id);
      return this.processToDetail(proc, proc.currentVersion?.trustTier ?? 'human');
    }
    if (args.kind === 'policy') {
      const policy = await this.prisma.policy.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        include: { currentVersion: { select: { trustTier: true } } },
      });
      if (!policy) this.notFound(args.kind, args.id);
      return this.policyToDetail(policy, policy.currentVersion?.trustTier ?? 'human');
    }
    if (args.kind === 'instruction') {
      const instruction = await this.prisma.instruction.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
      });
      if (!instruction) this.notFound(args.kind, args.id);
      return this.instructionToDetail(instruction);
    }
    const reg = await this.prisma.regulation.findFirst({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        ...(args.kind === 'standard' ? { category: 'standard' } : { category: 'regulation' }),
      },
      include: { currentVersion: { select: { trustTier: true } } },
    });
    if (!reg) this.notFound(args.kind, args.id);
    return this.regulationToDetail(reg, reg.currentVersion?.trustTier ?? 'human');
  }

  async getHistory(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
  }): Promise<RegulationHistoryResponse> {
    if (args.kind === 'instruction') return { items: [] };
    const resourceType = this.resourceTypeForKind(args.kind);
    const versions = await this.prisma.cardVersion.findMany({
      where: {
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
      },
      orderBy: { version: 'desc' },
      take: 100,
    });
    return {
      items: versions.map((v) => ({
        id: v.id,
        version: v.version,
        previousVersionId: v.previousVersionId,
        payload: (v.payload as Record<string, unknown>) ?? {},
        changeReason: v.changeReason,
        createdAt: v.createdAt.toISOString(),
        createdByUserId: v.createdByUserId,
      })),
    };
  }

  async getSources(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
  }): Promise<RegulationSourcesResponse> {
    const sourceBlockIds = await this.getSourceBlockIds(args.tenantId, args.id, args.kind);
    if (sourceBlockIds.length === 0) return { items: [] };

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: sourceBlockIds }, tenantId: args.tenantId },
      select: { id: true },
    });
    const blockIds = blocks.map((b) => b.id);
    if (blockIds.length === 0) return { items: [] };

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        blockId: true,
        quote: true,
        startMs: true,
        rawEventId: true,
      },
    });
    if (evidence.length === 0) return { items: [] };

    const rawEventIds = [...new Set(evidence.map((e) => e.rawEventId))];
    const sourceByRawEvent: Map<string, ProvenanceSourceRef> = this.provenance
      ? await this.provenance.resolveByRawEventIds(args.tenantId, rawEventIds)
      : new Map();

    const meetingIds = new Set<string>();
    for (const ref of sourceByRawEvent.values()) {
      if (ref.type === 'meeting' && ref.refId) meetingIds.add(ref.refId);
    }
    const meetingById = new Map<string, { id: string; title: string; date: string }>();
    if (meetingIds.size > 0) {
      const meetings = await this.prisma.meeting.findMany({
        where: { tenantId: args.tenantId, id: { in: [...meetingIds] } },
        select: { id: true, title: true, startedAt: true, createdAt: true },
      });
      for (const m of meetings) {
        meetingById.set(m.id, {
          id: m.id,
          title: m.title,
          date: (m.startedAt ?? m.createdAt).toISOString(),
        });
      }
    }

    return {
      items: evidence.map((ev) => {
        const ref = sourceByRawEvent.get(ev.rawEventId);
        const meetingId = ref && ref.type === 'meeting' ? ref.refId : null;
        const meeting = meetingId ? (meetingById.get(meetingId) ?? null) : null;
        return {
          blockId: ev.blockId,
          quote: ev.quote,
          startMs: ev.startMs ?? null,
          meeting,
        };
      }),
    };
  }

  private async getSourceBlockIds(
    tenantId: string,
    id: string,
    kind: RegulationKindDto,
  ): Promise<string[]> {
    if (kind === 'process') {
      const rec = await this.prisma.process.findFirst({
        where: { id, tenantId },
        select: { sourceBlockIds: true },
      });
      if (!rec) this.notFound(kind, id);
      return rec.sourceBlockIds;
    }
    if (kind === 'policy') {
      const rec = await this.prisma.policy.findFirst({
        where: { id, tenantId },
        select: { sourceBlockIds: true },
      });
      if (!rec) this.notFound(kind, id);
      return rec.sourceBlockIds;
    }
    if (kind === 'instruction') {
      const rec = await this.prisma.instruction.findFirst({
        where: { id, tenantId },
        select: { sourceBlockIds: true },
      });
      if (!rec) this.notFound(kind, id);
      return rec.sourceBlockIds;
    }
    const rec = await this.prisma.regulation.findFirst({
      where: {
        id,
        tenantId,
        ...(kind === 'standard' ? { category: 'standard' } : { category: 'regulation' }),
      },
      select: { sourceBlockIds: true },
    });
    if (!rec) this.notFound(kind, id);
    return rec.sourceBlockIds;
  }

  async getSummary(tenantId: string): Promise<RegulationSummaryResponse> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = { createdAt: { gte: weekAgo } };
    const [
      regulations,
      processes,
      processTemplates,
      instructions,
      policies,
      regWeek,
      procWeek,
      instrWeek,
      polWeek,
    ] = await Promise.all([
      this.prisma.regulation.count({ where: { tenantId } }),
      this.prisma.process.count({ where: { tenantId } }),
      this.prisma.processTemplate.count({
        where: { tenantId, deletedAt: null, status: 'active' },
      }),
      this.prisma.instruction.count({ where: { tenantId } }),
      this.prisma.policy.count({ where: { tenantId } }),
      this.prisma.regulation.count({ where: { tenantId, ...recent } }),
      this.prisma.process.count({ where: { tenantId, ...recent } }),
      this.prisma.instruction.count({ where: { tenantId, ...recent } }),
      this.prisma.policy.count({ where: { tenantId, ...recent } }),
    ]);
    const redesignEnabled =
      (await this.cfg?.getDynamic<boolean>(
        'knowledge_base.redesign.enabled',
        undefined,
        true,
      )) ?? true;
    return {
      regulations,
      processes,
      processTemplates,
      instructions,
      policies,
      weekDelta: regWeek + procWeek + instrWeek + polWeek,
      redesignEnabled,
    };
  }

  async supersede(args: {
    tenantId: string;
    id: string;
    body: SupersedeRegulationBody;
  }): Promise<{ ok: true }> {
    if (args.body.kind !== 'regulation' && args.body.kind !== 'standard') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'supersede_unsupported_kind',
          message: 'Замена другой версией поддержана только для регламентов и стандартов.',
        },
      });
    }
    const existing = await this.prisma.regulation.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!existing) this.notFound(args.body.kind, args.id);
    const successor = await this.prisma.regulation.findFirst({
      where: {
        id: args.body.supersededByRegulationId,
        tenantId: args.tenantId,
      },
      select: { id: true },
    });
    if (!successor) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'successor_not_found',
          message: 'Регламент-замена не найден в этой организации.',
        },
      });
    }
    await this.prisma.$transaction([
      this.prisma.regulation.update({
        where: { id: args.id },
        data: { status: 'deprecated' },
      }),
      this.prisma.regulation.update({
        where: { id: args.body.supersededByRegulationId },
        data: { supersedesId: args.id },
      }),
    ]);
    return { ok: true };
  }

  async confirm(args: {
    tenantId: string;
    id: string;
    body: ConfirmRegulationBody;
  }): Promise<{ ok: true; lastConfirmedAt: string }> {
    const now = new Date();
    if (args.body.kind === 'process') {
      const exists = await this.prisma.process.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: { id: true },
      });
      if (!exists) this.notFound(args.body.kind, args.id);
      await this.prisma.process.update({
        where: { id: args.id },
        data: { lastConfirmedAt: now },
      });
      return { ok: true, lastConfirmedAt: now.toISOString() };
    }
    if (args.body.kind === 'policy') {
      const exists = await this.prisma.policy.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: { id: true },
      });
      if (!exists) this.notFound(args.body.kind, args.id);
      await this.prisma.policy.update({
        where: { id: args.id },
        data: { lastConfirmedAt: now },
      });
      return { ok: true, lastConfirmedAt: now.toISOString() };
    }
    if (args.body.kind === 'instruction') {
      const exists = await this.prisma.instruction.findFirst({
        where: { id: args.id, tenantId: args.tenantId },
        select: { id: true },
      });
      if (!exists) this.notFound(args.body.kind, args.id);
      await this.prisma.instruction.update({
        where: { id: args.id },
        data: { lastConfirmedAt: now },
      });
      return { ok: true, lastConfirmedAt: now.toISOString() };
    }
    const exists = await this.prisma.regulation.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!exists) this.notFound(args.body.kind, args.id);
    await this.prisma.regulation.update({
      where: { id: args.id },
      data: { lastConfirmedAt: now },
    });
    return { ok: true, lastConfirmedAt: now.toISOString() };
  }

  async dispute(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
    reason?: string;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    if (args.kind === 'instruction') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'instruction_action_unsupported',
          message: 'Оспаривание/исправление инструкций появится в следующей версии.',
        },
      });
    }
    await this.findByKind(args.tenantId, args.id, args.kind);
    await this.curation.recordDecision({
      tenantId: args.tenantId,
      resourceType: this.kindToResourceType(args.kind),
      resourceId: args.id,
      decisionType: 'mark_as_misleading',
      recordedBy: args.actorUserId,
      reason: args.reason ?? null,
    });
    return { ok: true };
  }

  async correct(args: {
    tenantId: string;
    id: string;
    kind: RegulationKindDto;
    correctedPayload: {
      name?: string;
      contentMd?: string;
      statement?: string;
      description?: string;
    };
    reason?: string;
    actorUserId: string;
    canApplyDirectly: boolean;
  }): Promise<{ ok: true; applied: boolean }> {
    if (args.kind === 'instruction') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'instruction_action_unsupported',
          message: 'Исправление инструкций появится в следующей версии.',
        },
      });
    }
    const existing = await this.findByKind(args.tenantId, args.id, args.kind);
    const resourceType = this.kindToResourceType(args.kind);

    if (!args.canApplyDirectly) {
      await this.curation.submitProposal({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        proposedPayload: args.correctedPayload,
        submittedBy: args.actorUserId,
        reason: args.reason ?? null,
      });
      return { ok: true, applied: false };
    }

    const p = args.correctedPayload;

    if (resourceType === 'process') {
      const before = {
        name: existing.name,
        description: (existing as { description?: string | null }).description ?? null,
      };
      const data: Prisma.ProcessUpdateInput = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.description !== undefined) data.description = p.description;
      const rec = await this.prisma.process.update({ where: { id: args.id }, data });
      await this.writeRegulationCardVersion({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        payload: { name: rec.name, description: rec.description, scope: rec.scope },
        actorUserId: args.actorUserId,
        changeReason: 'user_correction',
      });
      await this.recordCorrectionSample({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        actorUserId: args.actorUserId,
        reason: args.reason ?? null,
        before,
        after: args.correctedPayload,
      });
    } else if (resourceType === 'policy') {
      const before = {
        name: existing.name,
        contentMd: (existing as { contentMd?: string }).contentMd ?? null,
      };
      const data: Prisma.PolicyUpdateInput = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.contentMd !== undefined) data.contentMd = p.contentMd;
      const rec = await this.prisma.policy.update({ where: { id: args.id }, data });
      await this.writeRegulationCardVersion({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        payload: {
          name: rec.name,
          contentMd: rec.contentMd,
          severity: rec.severity,
          scope: rec.scope,
        },
        actorUserId: args.actorUserId,
        changeReason: 'user_correction',
      });
      await this.recordCorrectionSample({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        actorUserId: args.actorUserId,
        reason: args.reason ?? null,
        before,
        after: args.correctedPayload,
      });
    } else {
      const before = {
        name: existing.name,
        contentMd: (existing as { contentMd?: string }).contentMd ?? null,
        statement: (existing as { statement?: string | null }).statement ?? null,
      };
      const data: Prisma.RegulationUpdateInput = {};
      if (p.name !== undefined) data.name = p.name;
      if (p.contentMd !== undefined) data.contentMd = p.contentMd;
      if (p.statement !== undefined) data.statement = p.statement;
      const rec = await this.prisma.regulation.update({ where: { id: args.id }, data });
      await this.writeRegulationCardVersion({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        payload: {
          name: rec.name,
          contentMd: rec.contentMd,
          statement: rec.statement,
          category: rec.category,
          scope: rec.scope,
        },
        actorUserId: args.actorUserId,
        changeReason: 'user_correction',
      });
      await this.recordCorrectionSample({
        tenantId: args.tenantId,
        resourceType,
        resourceId: args.id,
        actorUserId: args.actorUserId,
        reason: args.reason ?? null,
        before,
        after: args.correctedPayload,
      });
    }

    return { ok: true, applied: true };
  }

  private async recordCorrectionSample(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    actorUserId: string;
    reason: string | null;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }): Promise<void> {
    await this.curation.recordDecision({
      tenantId: args.tenantId,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      decisionType: 'approve_with_edits',
      recordedBy: args.actorUserId,
      reason: args.reason,
      context: { before: args.before, after: args.after },
    });
  }

  private kindToResourceType(kind: RegulationKindDto): 'regulation' | 'process' | 'policy' {
    if (kind === 'process') return 'process';
    if (kind === 'policy') return 'policy';
    return 'regulation';
  }

  private async findByKind(
    tenantId: string,
    id: string,
    kind: RegulationKindDto,
  ): Promise<
    | { id: string; name: string; description: string | null; scope: string | null }
    | {
        id: string;
        name: string;
        contentMd: string;
        statement: string | null;
        category: string;
        scope: string | null;
      }
    | { id: string; name: string; contentMd: string; severity: string; scope: string | null }
  > {
    if (kind === 'process') {
      const rec = await this.prisma.process.findFirst({
        where: { id, tenantId },
      });
      if (!rec) this.notFound(kind, id);
      return rec;
    }
    if (kind === 'policy') {
      const rec = await this.prisma.policy.findFirst({
        where: { id, tenantId },
      });
      if (!rec) this.notFound(kind, id);
      return rec;
    }
    const rec = await this.prisma.regulation.findFirst({
      where: {
        id,
        tenantId,
        ...(kind === 'standard' ? { category: 'standard' } : { category: 'regulation' }),
      },
    });
    if (!rec) this.notFound(kind, id);
    return rec;
  }

  private async writeRegulationCardVersion(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    payload: Record<string, unknown>;
    actorUserId: string;
    changeReason: string;
  }): Promise<void> {
    const last = await this.prisma.cardVersion.findFirst({
      where: {
        tenantId: args.tenantId,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;
    const created = await this.prisma.cardVersion.create({
      data: {
        tenantId: args.tenantId,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        version: nextVersion,
        previousVersionId: last?.id ?? null,
        payload: args.payload as Prisma.InputJsonValue,
        changeReason: args.changeReason,
        createdByUserId: args.actorUserId,
      },
    });
    if (args.resourceType === 'process') {
      await this.prisma.process.update({
        where: { id: args.resourceId },
        data: { currentVersionId: created.id },
      });
    } else if (args.resourceType === 'policy') {
      await this.prisma.policy.update({
        where: { id: args.resourceId },
        data: { currentVersionId: created.id },
      });
    } else {
      await this.prisma.regulation.update({
        where: { id: args.resourceId },
        data: { currentVersionId: created.id },
      });
    }
    try {
      this.events?.emit('card-version.created', {
        tenantId: args.tenantId,
        cardVersionId: created.id,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      });
    } catch {}
  }

  private regulationsWhere(tenantId: string, q: ListRegulationsQuery): Prisma.RegulationWhereInput {
    const where: Prisma.RegulationWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contentMd: { contains: q.q, mode: 'insensitive' } },
        { statement: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private processesWhere(tenantId: string, q: ListRegulationsQuery): Prisma.ProcessWhereInput {
    const where: Prisma.ProcessWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { description: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private policiesWhere(tenantId: string, q: ListRegulationsQuery): Prisma.PolicyWhereInput {
    const where: Prisma.PolicyWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contentMd: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private instructionsWhere(
    tenantId: string,
    q: ListRegulationsQuery,
  ): Prisma.InstructionWhereInput {
    const where: Prisma.InstructionWhereInput = { tenantId };
    if (q.status) where.status = q.status;
    if (q.scope) where.scope = { contains: q.scope, mode: 'insensitive' };
    if (q.q) {
      where.OR = [
        { name: { contains: q.q, mode: 'insensitive' } },
        { contentMd: { contains: q.q, mode: 'insensitive' } },
        { statement: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private regulationToListItem(
    r: Awaited<ReturnType<PrismaService['regulation']['findFirst']>> extends null | infer T
      ? NonNullable<T>
      : never,
    trustTier: TrustTierDto,
  ): RegulationListItemDto {
    return {
      id: r.id,
      kind: r.category === 'standard' ? 'standard' : 'regulation',
      name: r.name,
      statement: r.statement ?? null,
      category: r.category === 'standard' ? 'standard' : 'regulation',
      severity: null,
      scope: r.scope ?? null,
      status: r.status,
      ownerPersonId: r.ownerPersonId ?? null,
      confidence: r.confidence ?? null,
      trustTier,
      previewQuote: r.previewQuote ?? null,
      previewSourceRef: (r.previewSourceRef as ProvenancePreviewRef | null) ?? null,
      lastConfirmedAt: r.lastConfirmedAt ? r.lastConfirmedAt.toISOString() : null,
      updatedAt: r.updatedAt.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }

  private processToListItem(
    p: Awaited<ReturnType<PrismaService['process']['findFirst']>> extends null | infer T
      ? NonNullable<T>
      : never,
    trustTier: TrustTierDto,
  ): RegulationListItemDto {
    return {
      id: p.id,
      kind: 'process',
      name: p.name,
      statement: p.description ?? null,
      category: null,
      severity: null,
      scope: p.scope ?? null,
      status: p.status,
      ownerPersonId: p.ownerPersonId ?? null,
      confidence: p.confidence ?? null,
      trustTier,
      previewQuote: null,
      previewSourceRef: null,
      lastConfirmedAt: p.lastConfirmedAt ? p.lastConfirmedAt.toISOString() : null,
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    };
  }

  private policyToListItem(
    p: Awaited<ReturnType<PrismaService['policy']['findFirst']>> extends null | infer T
      ? NonNullable<T>
      : never,
    trustTier: TrustTierDto,
  ): RegulationListItemDto {
    return {
      id: p.id,
      kind: 'policy',
      name: p.name,
      statement: p.contentMd ?? null,
      category: null,
      severity: p.severity,
      scope: p.scope ?? null,
      status: p.status,
      ownerPersonId: p.ownerPersonId ?? null,
      confidence: p.confidence ?? null,
      trustTier,
      previewQuote: null,
      previewSourceRef: null,
      lastConfirmedAt: p.lastConfirmedAt ? p.lastConfirmedAt.toISOString() : null,
      updatedAt: p.updatedAt.toISOString(),
      createdAt: p.createdAt.toISOString(),
    };
  }

  private instructionToListItem(
    i: NonNullable<Awaited<ReturnType<PrismaService['instruction']['findFirst']>>>,
  ): RegulationListItemDto {
    return {
      id: i.id,
      kind: 'instruction',
      name: i.name,
      statement: i.statement ?? i.contentMd ?? null,
      category: null,
      severity: null,
      scope: i.scope ?? null,
      status: i.status,
      ownerPersonId: i.ownerPersonId ?? null,
      confidence: i.confidence ?? null,
      extractionStatus: i.status === 'active' ? 'exists' : 'discussed',
      forRole: i.forRole ?? null,
      trustTier: 'human',
      previewQuote: null,
      previewSourceRef: null,
      lastConfirmedAt: i.lastConfirmedAt ? i.lastConfirmedAt.toISOString() : null,
      updatedAt: i.updatedAt.toISOString(),
      createdAt: i.createdAt.toISOString(),
    };
  }

  private instructionToDetail(
    i: NonNullable<Awaited<ReturnType<PrismaService['instruction']['findFirst']>>>,
  ): RegulationDetailDto {
    const base = this.instructionToListItem(i);
    return {
      ...base,
      contentMd: i.contentMd,
      sourceBlockIds: i.sourceBlockIds,
      personSubjectIds: i.personSubjectIds,
      currentVersionId: i.currentVersionId ?? null,
      needsAttention: computeRegulationNeedsAttention({
        kind: base.kind,
        ownerPersonId: base.ownerPersonId,
        scope: base.scope,
        severity: base.severity,
        steps: null,
      }),
    };
  }

  private regulationToDetail(
    r: NonNullable<Awaited<ReturnType<PrismaService['regulation']['findFirst']>>>,
    trustTier: TrustTierDto,
  ): RegulationDetailDto {
    const base = this.regulationToListItem(r, trustTier);
    return {
      ...base,
      contentMd: r.contentMd,
      sourceBlockIds: r.sourceBlockIds,
      personSubjectIds: r.personSubjectIds,
      currentVersionId: r.currentVersionId ?? null,
      supersedesId: r.supersedesId ?? null,
      needsAttention: computeRegulationNeedsAttention({
        kind: base.kind,
        ownerPersonId: base.ownerPersonId,
        scope: base.scope,
        severity: base.severity,
        steps: null,
      }),
    };
  }

  private processToDetail(
    p: NonNullable<
      Awaited<ReturnType<typeof this.prisma.process.findFirst>> & {
        steps: Array<{
          id: string;
          order: number;
          name: string;
          description: string | null;
          slaMinutes: number | null;
        }>;
      }
    >,
    trustTier: TrustTierDto,
  ): RegulationDetailDto {
    const base = this.processToListItem(p, trustTier);
    const steps = p.steps.map((s) => ({
      id: s.id,
      order: s.order,
      name: s.name,
      description: s.description,
      slaMinutes: s.slaMinutes,
    }));
    return {
      ...base,
      contentMd: p.description ?? '',
      sourceBlockIds: p.sourceBlockIds,
      personSubjectIds: p.personSubjectIds,
      currentVersionId: p.currentVersionId ?? null,
      steps,
      needsAttention: computeRegulationNeedsAttention({
        kind: base.kind,
        ownerPersonId: base.ownerPersonId,
        scope: base.scope,
        severity: base.severity,
        steps,
      }),
    };
  }

  private policyToDetail(
    p: NonNullable<Awaited<ReturnType<PrismaService['policy']['findFirst']>>>,
    trustTier: TrustTierDto,
  ): RegulationDetailDto {
    const base = this.policyToListItem(p, trustTier);
    return {
      ...base,
      contentMd: p.contentMd,
      sourceBlockIds: p.sourceBlockIds,
      personSubjectIds: p.personSubjectIds,
      currentVersionId: p.currentVersionId ?? null,
      needsAttention: computeRegulationNeedsAttention({
        kind: base.kind,
        ownerPersonId: base.ownerPersonId,
        scope: base.scope,
        severity: base.severity,
        steps: null,
      }),
    };
  }

  private resourceTypeForKind(kind: RegulationKindDto): string {
    if (kind === 'process') return 'process';
    if (kind === 'policy') return 'policy';
    return 'regulation';
  }

  private notFound(kind: string, id: string): never {
    throw new NotFoundException({
      ok: false,
      error: {
        code: 'regulation_not_found',
        message: `Запись (${kind}) ${id} не найдена в этой организации.`,
      },
    });
  }
}
