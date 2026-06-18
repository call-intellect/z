import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type Decision, type DecisionStatus, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import { KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';
import type {
  ChangeStatusBody,
  CreateDecisionBody,
  DecisionAlternativeDto,
  DecisionDetailDto,
  DecisionHistoryResponse,
  DecisionListItemDto,
  DecisionStatusDto,
  DecisionSupersedeChainResponse,
  ListDecisionsQuery,
  ListDecisionsResponse,
  SetOutcomesBody,
  SupersedeDecisionBody,
  TrustTierDto,
} from '../dto/decisions.dto';

@Injectable()
export class DecisionsService {
  private readonly logger = new Logger(DecisionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
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
  ) {}

  private async gateProjections<T extends { id: string; sourceBlockIds: string[] }>(
    items: T[],
    args: { tenantId: string; userId?: string; surface: string },
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
      this.metrics?.incAccessDenied({ surface: args.surface }, denied);
      return items.filter((i) => accessibleIds.has(i.id));
    }
    this.metrics?.incAccessShadowDiff({ surface: args.surface }, denied);
    return items;
  }

  async list(args: {
    tenantId: string;
    userId?: string;
    query: ListDecisionsQuery;
  }): Promise<ListDecisionsResponse> {
    const q = args.query;
    const where = this.buildWhere(args.tenantId, q);
    const [items, total] = await Promise.all([
      this.prisma.decision.findMany({
        where,
        orderBy: [{ decidedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (q.page - 1) * q.limit,
        take: q.limit,
        include: { currentVersion: { select: { trustTier: true } } },
      }),
      this.prisma.decision.count({ where }),
    ]);
    const visible = await this.gateProjections(items, {
      tenantId: args.tenantId,
      userId: args.userId,
      surface: 'decisions',
    });
    return {
      items: visible.map((d) => this.toListItem(d, d.currentVersion?.trustTier ?? 'human')),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, q.limit))),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<DecisionDetailDto> {
    const decision = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      include: { currentVersion: { select: { trustTier: true } } },
    });
    if (!decision) this.notFound(args.id);
    return this.toDetail(decision, decision.currentVersion?.trustTier ?? 'human');
  }

  async getHistory(args: { tenantId: string; id: string }): Promise<DecisionHistoryResponse> {
    const versions = await this.prisma.cardVersion.findMany({
      where: {
        tenantId: args.tenantId,
        resourceType: 'decision',
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

  async getSupersedeChain(args: {
    tenantId: string;
    userId?: string;
    id: string;
  }): Promise<DecisionSupersedeChainResponse> {
    type DecisionWithTier = Decision & {
      currentVersion: { trustTier: TrustTierDto } | null;
    };

    const root: DecisionWithTier | null = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      include: { currentVersion: { select: { trustTier: true } } },
    });
    if (!root) this.notFound(args.id);

    const ancestors: DecisionWithTier[] = [];
    let cur: DecisionWithTier | null = root;
    const seen = new Set<string>([root.id]);
    while (cur?.supersedesId && ancestors.length < 50) {
      const parent: DecisionWithTier | null = await this.prisma.decision.findFirst({
        where: { id: cur.supersedesId, tenantId: args.tenantId },
        include: { currentVersion: { select: { trustTier: true } } },
      });
      if (!parent || seen.has(parent.id)) break;
      ancestors.push(parent);
      seen.add(parent.id);
      cur = parent;
    }

    const descendants: DecisionWithTier[] = [];
    const queue: string[] = [root.id];
    const seenDesc = new Set<string>([root.id]);
    while (queue.length > 0 && descendants.length < 50) {
      const cur = queue.shift();
      if (!cur) break;
      const children = await this.prisma.decision.findMany({
        where: { supersedesId: cur, tenantId: args.tenantId },
        take: 20,
        include: { currentVersion: { select: { trustTier: true } } },
      });
      for (const c of children) {
        if (seenDesc.has(c.id)) continue;
        seenDesc.add(c.id);
        descendants.push(c);
        queue.push(c.id);
      }
    }

    const [visAncestors, visDescendants] = await Promise.all([
      this.gateProjections(ancestors, {
        tenantId: args.tenantId,
        userId: args.userId,
        surface: 'decisions',
      }),
      this.gateProjections(descendants, {
        tenantId: args.tenantId,
        userId: args.userId,
        surface: 'decisions',
      }),
    ]);
    return {
      ancestors: visAncestors.map((d) =>
        this.toListItem(d, d.currentVersion?.trustTier ?? 'human'),
      ),
      descendants: visDescendants.map((d) =>
        this.toListItem(d, d.currentVersion?.trustTier ?? 'human'),
      ),
    };
  }

  async supersede(args: {
    tenantId: string;
    id: string;
    body: SupersedeDecisionBody;
    reviewerUserId: string;
  }): Promise<{ ok: true }> {
    if (args.body.supersededByDecisionId === args.id) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'self_supersede',
          message: 'Решение не может заменять само себя.',
        },
      });
    }
    const existing = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const successor = await this.prisma.decision.findFirst({
      where: {
        id: args.body.supersededByDecisionId,
        tenantId: args.tenantId,
      },
    });
    if (!successor) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'successor_not_found',
          message: 'Заменяющее решение не найдено в этой организации.',
        },
      });
    }

    const now = new Date();
    const evolvingMeta = {
      existingValidUntil: now.toISOString(),
      newValidFrom: (successor.decidedAt ?? now).toISOString(),
    };

    await this.prisma.$transaction([
      this.prisma.decision.update({
        where: { id: existing.id },
        data: {
          status: 'superseded',
          validUntil: now,
        },
      }),
      this.prisma.decision.update({
        where: { id: successor.id },
        data: {
          supersedesId: existing.id,
          validFrom: successor.validFrom ?? successor.decidedAt ?? now,
        },
      }),
    ]);

    try {
      const conflict = await this.conflicts.report({
        tenantId: args.tenantId,
        resourceType: 'decision',
        existingId: existing.id,
        newId: successor.id,
        relationType: 'supersedes',
        detectedBy: 'manual',
        evidence: {
          oldStatement: (existing.statement ?? existing.text ?? '').slice(0, 1_000),
          newStatement: (successor.statement ?? successor.text ?? '').slice(0, 1_000),
          supersedeReason: args.body.supersedeReason ?? null,
          suggestedResolution: 'evolving',
          evolvingMeta,
        },
      });
      await this.conflicts.resolve({
        tenantId: args.tenantId,
        conflictId: conflict.id,
        reviewerUserId: args.reviewerUserId,
        resolution: 'evolving',
        evolvingMeta,
        reasoning: args.body.supersedeReason ?? 'manual supersede via API',
      });
    } catch (err) {
      this.logger.warn(
        {
          decisionId: existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'decisions.supersede: ConflictItem (evolving) не создался — продолжаю',
      );
    }

    return { ok: true };
  }

  async changeStatus(args: {
    tenantId: string;
    id: string;
    body: ChangeStatusBody;
    reviewerUserId: string;
  }): Promise<{ ok: true; status: DecisionStatusDto }> {
    const existing = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const updated = await this.prisma.decision.update({
      where: { id: existing.id },
      data: {
        status: args.body.newStatus as DecisionStatus,
        lastConfirmedAt: new Date(),
      },
    });

    try {
      await this.writeCardVersion({
        tenantId: args.tenantId,
        decision: updated,
        reviewerUserId: args.reviewerUserId,
        changeReason: args.body.reason ?? `status: ${existing.status} → ${args.body.newStatus}`,
      });
    } catch (err) {
      this.logger.warn(
        {
          decisionId: existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'decisions.changeStatus: CardVersion не записался — продолжаю',
      );
    }

    return { ok: true, status: updated.status as DecisionStatusDto };
  }

  async setOutcomes(args: {
    tenantId: string;
    id: string;
    body: SetOutcomesBody;
    reviewerUserId: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    const updated = await this.prisma.decision.update({
      where: { id: existing.id },
      data: { actualOutcomes: args.body.actualOutcomes },
    });

    try {
      await this.writeCardVersion({
        tenantId: args.tenantId,
        decision: updated,
        reviewerUserId: args.reviewerUserId,
        changeReason: 'set actualOutcomes',
      });
    } catch (err) {
      this.logger.warn(
        {
          decisionId: existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'decisions.setOutcomes: CardVersion не записался — продолжаю',
      );
    }
    return { ok: true };
  }

  async createManual(args: {
    tenantId: string;
    body: CreateDecisionBody;
    createdByUserId: string;
  }): Promise<{ id: string }> {
    const status = (args.body.status ?? 'approved') as DecisionStatus;
    const decidedAt = args.body.decidedAt ? new Date(args.body.decidedAt) : null;
    const deadline = args.body.deadline ? new Date(args.body.deadline) : null;

    const decision = await this.prisma.decision.create({
      data: {
        tenantId: args.tenantId,
        text: args.body.statement.slice(0, 1_000),
        statement: args.body.statement,
        rationale: args.body.rationale ?? null,
        alternatives:
          args.body.alternatives && args.body.alternatives.length > 0
            ? (args.body.alternatives as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        decidedByPersonIds: args.body.decidedByPersonIds ?? [],
        decidedByPersonId: args.body.decidedByPersonIds?.[0] ?? null,
        decidedAt,
        deadline,
        status,
        affectsEntityIds: args.body.affectsEntityIds ?? [],
        sourceBlockIds: [],
        personSubjectIds: [],
        confidence: new Prisma.Decimal(0.95),
        dataClass: 'sensitive',
        validFrom: decidedAt ?? null,
      },
    });

    try {
      await this.curation.triage({
        tenantId: args.tenantId,
        resourceType: 'decision',
        resourceId: decision.id,
        confidence: 0.95,
        proposedPayload: {
          statement: decision.statement,
          rationale: decision.rationale,
          alternatives: args.body.alternatives ?? [],
          decidedByPersonIds: decision.decidedByPersonIds,
          decidedAt: decidedAt ? decidedAt.toISOString() : null,
          deadline: deadline ? deadline.toISOString() : null,
          status: decision.status,
          affectsEntityIds: decision.affectsEntityIds,
          createdByUserId: args.createdByUserId,
        },
        conflictSignal: 'none',
        createdByUserId: args.createdByUserId,
        dataClass: 'sensitive',
      });
    } catch (err) {
      this.logger.warn(
        {
          decisionId: decision.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'decisions.createManual: triage упал — карточка осталась без CurationItem',
      );
    }
    return { id: decision.id };
  }

  private buildWhere(tenantId: string, q: ListDecisionsQuery): Prisma.DecisionWhereInput {
    const where: Prisma.DecisionWhereInput = { tenantId };
    if (q.status) where.status = q.status as DecisionStatus;
    if (q.decided_by) {
      where.decidedByPersonIds = { has: q.decided_by };
    }
    if (q.affects_entity_id) {
      where.affectsEntityIds = { has: q.affects_entity_id };
    }
    if (q.deadline_filter === 'overdue') {
      where.deadline = { lt: new Date(), not: null };
      where.status = {
        notIn: ['implemented', 'cancelled', 'rejected', 'superseded'],
      };
    } else if (q.deadline_filter === 'upcoming') {
      where.deadline = { gte: new Date() };
    }
    if (q.q) {
      where.OR = [
        { statement: { contains: q.q, mode: 'insensitive' } },
        { rationale: { contains: q.q, mode: 'insensitive' } },
        { actualOutcomes: { contains: q.q, mode: 'insensitive' } },
        { text: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private toListItem(d: Decision, trustTier: TrustTierDto = 'human'): DecisionListItemDto {
    return {
      id: d.id,
      statement: d.statement ?? d.text ?? '',
      status: d.status as DecisionStatusDto,
      decidedByPersonIds: d.decidedByPersonIds,
      decidedAt: d.decidedAt ? d.decidedAt.toISOString() : null,
      deadline: d.deadline ? d.deadline.toISOString() : null,
      supersedesId: d.supersedesId,
      affectsEntityIds: d.affectsEntityIds,
      confidence: d.confidence !== null ? Number(d.confidence) : null,
      trustTier,
      updatedAt: d.updatedAt.toISOString(),
      createdAt: d.createdAt.toISOString(),
    };
  }

  private toDetail(d: Decision, trustTier: TrustTierDto): DecisionDetailDto {
    const alternatives = this.parseAlternatives(d.alternatives);
    return {
      ...this.toListItem(d, trustTier),
      rationale: d.rationale,
      alternatives,
      sourceBlockIds: d.sourceBlockIds,
      personSubjectIds: d.personSubjectIds,
      currentVersionId: d.currentVersionId,
      validFrom: d.validFrom ? d.validFrom.toISOString() : null,
      validUntil: d.validUntil ? d.validUntil.toISOString() : null,
      actualOutcomes: d.actualOutcomes,
      dataClass: d.dataClass,
    };
  }

  private parseAlternatives(value: Prisma.JsonValue | null): DecisionAlternativeDto[] {
    if (!Array.isArray(value)) return [];
    const result: DecisionAlternativeDto[] = [];
    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as { option?: unknown; reasonRejected?: unknown };
        if (typeof obj.option === 'string') {
          result.push({
            option: obj.option,
            reasonRejected: typeof obj.reasonRejected === 'string' ? obj.reasonRejected : null,
          });
        }
      }
    }
    return result;
  }

  private async writeCardVersion(args: {
    tenantId: string;
    decision: Decision;
    reviewerUserId: string;
    changeReason: string;
  }): Promise<void> {
    const last = await this.prisma.cardVersion.findFirst({
      where: {
        tenantId: args.tenantId,
        resourceType: 'decision',
        resourceId: args.decision.id,
      },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    const nextVersion = (last?.version ?? 0) + 1;
    const created = await this.prisma.cardVersion.create({
      data: {
        tenantId: args.tenantId,
        resourceType: 'decision',
        resourceId: args.decision.id,
        version: nextVersion,
        previousVersionId: last?.id ?? null,
        payload: {
          statement: args.decision.statement,
          rationale: args.decision.rationale,
          status: args.decision.status,
          decidedByPersonIds: args.decision.decidedByPersonIds,
          decidedAt: args.decision.decidedAt ? args.decision.decidedAt.toISOString() : null,
          deadline: args.decision.deadline ? args.decision.deadline.toISOString() : null,
          actualOutcomes: args.decision.actualOutcomes,
          validFrom: args.decision.validFrom ? args.decision.validFrom.toISOString() : null,
          validUntil: args.decision.validUntil ? args.decision.validUntil.toISOString() : null,
        } as Prisma.InputJsonValue,
        changeReason: args.changeReason,
        createdByUserId: args.reviewerUserId,
      },
    });
    await this.prisma.decision.update({
      where: { id: args.decision.id },
      data: { currentVersionId: created.id },
    });
    try {
      this.events?.emit('card-version.created', {
        tenantId: args.tenantId,
        cardVersionId: created.id,
        resourceType: 'decision',
        resourceId: args.decision.id,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'card-version.created emit failed (handled inside)',
      );
    }
  }

  async dispute(args: {
    tenantId: string;
    id: string;
    reason?: string;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true },
    });
    if (!existing) this.notFound(args.id);
    await this.curation.recordDecision({
      tenantId: args.tenantId,
      resourceType: 'decision',
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
    correctedPayload: { statement?: string; rationale?: string };
    reason?: string;
    actorUserId: string;
    canApplyDirectly: boolean;
  }): Promise<{ ok: true; applied: boolean }> {
    const existing = await this.prisma.decision.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!existing) this.notFound(args.id);

    if (!args.canApplyDirectly) {
      await this.curation.submitProposal({
        tenantId: args.tenantId,
        resourceType: 'decision',
        resourceId: args.id,
        proposedPayload: args.correctedPayload,
        submittedBy: args.actorUserId,
        reason: args.reason ?? null,
      });
      return { ok: true, applied: false };
    }

    const before = {
      statement: existing.statement,
      rationale: existing.rationale,
    };
    const data: Prisma.DecisionUpdateInput = {};
    if (args.correctedPayload.statement !== undefined) {
      data.statement = args.correctedPayload.statement;
      data.text = args.correctedPayload.statement.slice(0, 1000);
    }
    if (args.correctedPayload.rationale !== undefined) {
      data.rationale = args.correctedPayload.rationale;
    }
    const updated = await this.prisma.decision.update({
      where: { id: args.id },
      data,
    });
    await this.writeCardVersion({
      tenantId: args.tenantId,
      decision: updated,
      reviewerUserId: args.actorUserId,
      changeReason: 'user_correction',
    });
    await this.curation.recordDecision({
      tenantId: args.tenantId,
      resourceType: 'decision',
      resourceId: args.id,
      decisionType: 'approve_with_edits',
      recordedBy: args.actorUserId,
      reason: args.reason ?? null,
      context: { before, after: args.correctedPayload },
    });
    return { ok: true, applied: true };
  }

  private notFound(id: string): never {
    throw new NotFoundException({
      ok: false,
      error: {
        code: 'decision_not_found',
        message: `Решение ${id} не найдено в этой организации.`,
      },
    });
  }
}
