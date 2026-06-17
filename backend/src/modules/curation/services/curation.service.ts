import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type CurationDecisionType,
  type CurationItem,
  type CurationLevel,
  Prisma,
  type TrustTier,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { levelRu, resourceTypeRu } from '../../pending-actions/resource-type-ru';
import { SkillTraitCategoryService } from '../../skills/services/skill-trait-categories.service';
import type {
  CurationDecisionDto,
  CurationDecisionTypeDto,
  CurationItemDetailDto,
  CurationItemDto,
  CurationLevelDto,
  CurationSettingsDto,
  ListCurationQueueQuery,
  ListCurationQueueResponse,
  OverrideStatsItemDto,
  OverrideStatsResponse,
  ProvisionalAuditStatsItemDto,
  ProvisionalAuditStatsResponse,
  UpdateCurationSettingsBody,
} from '../dto/curation.dto';

import { CuratorRoutingService } from './curator-routing.service';

export interface TriageInput {
  tenantId: string;
  resourceType: string;
  resourceId: string;
  confidence: number;
  calibratedConfidence?: number;
  proposedPayload: Record<string, unknown>;
  conflictSignal?: 'none' | 'soft' | 'hard';
  conflictIds?: string[];
  criteria?: Record<string, unknown>;
  createdByUserId?: string | null;
  dataClass?: 'public' | 'internal' | 'sensitive' | 'private';
}

export type TriageDecision = 'auto' | 'provisional' | 'light' | 'deep';

export interface TriageResult {
  decision: TriageDecision;
  cardVersionId: string | null;
  curationItemId: string | null;
  candidateCuratorIds: string[];
}

export interface DecideInput {
  tenantId: string;
  curationItemId: string;
  reviewerUserId: string;
  decisionType: CurationDecisionTypeDto;
  payload?: Record<string, unknown>;
  reasoning?: string;
}

export interface RecordDecisionInput {
  tenantId: string;
  resourceType: string;
  resourceId: string;
  decisionType: CurationDecisionTypeDto;
  recordedBy: string;
  reason?: string | null;
  taskType?: string | null;
  context?: Record<string, unknown>;
}

const DEFAULT_AUTO_THRESHOLD = 0.85;
const DEFAULT_DEEP_REVIEW_THRESHOLD = 0.6;
const DEFAULT_CRITICAL_TYPES = ['regulation', 'process', 'decision'] as const;
const DEFAULT_PROVISIONAL_THRESHOLD = 0.8;
const DEFAULT_AUDIT_SAMPLE_RATE = 0.05;
export const KILL_SWITCH_PROVISIONAL_THRESHOLD = 1.01;

@Injectable()
export class CurationService {
  private readonly logger = new Logger(CurationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(CuratorRoutingService)
    private readonly routing: CuratorRoutingService,
    @Optional()
    @Inject(SkillTraitCategoryService)
    private readonly skillCategories: SkillTraitCategoryService | null,
    @Optional()
    @Inject(EventEmitter2)
    private readonly events: EventEmitter2 | null = null,
    @Optional()
    @Inject(MultiAgentDebateService)
    private readonly debate: MultiAgentDebateService | null = null,
  ) {}

  async triage(input: TriageInput): Promise<TriageResult> {
    if (!input.tenantId || !input.resourceType || !input.resourceId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_triage_input',
          message: 'tenantId / resourceType / resourceId обязательны для triage',
        },
      });
    }
    if (input.confidence < 0 || input.confidence > 1) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_confidence',
          message: 'confidence должен быть в диапазоне [0..1]',
        },
      });
    }

    const settings = await this.getSettings(input.tenantId);
    const conflict = input.conflictSignal ?? 'none';
    const isCritical = settings.criticalTypes.includes(input.resourceType);

    const effectiveConfidence =
      typeof input.calibratedConfidence === 'number' && Number.isFinite(input.calibratedConfidence)
        ? Math.max(0, Math.min(1, input.calibratedConfidence))
        : input.confidence;

    const autoT = settings.autoThresholdByType?.[input.resourceType] ?? settings.autoThreshold;
    const deepT =
      settings.deepReviewThresholdByType?.[input.resourceType] ?? settings.deepReviewThreshold;
    const provisionalT =
      settings.provisionalThresholdByType?.[input.resourceType] ??
      settings.provisionalThreshold ??
      DEFAULT_PROVISIONAL_THRESHOLD;

    if (!isCritical && conflict === 'none' && effectiveConfidence >= autoT) {
      const version = await this.createInitialCardVersion(input, 'auto');
      this.metrics.incCurationAutoCanonical({ resourceType: input.resourceType });
      this.logger.log(
        {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          versionId: version.id,
        },
        'curation.triage: auto-canonical',
      );
      const auditItemId = await this.maybeCreateAuditSample({
        input,
        settings,
        trustTier: 'auto',
      });
      return {
        decision: 'auto',
        cardVersionId: version.id,
        curationItemId: auditItemId,
        candidateCuratorIds: [],
      };
    }

    if (
      isCritical &&
      conflict !== 'hard' &&
      settings.aiVerifierEnabled &&
      this.debate &&
      effectiveConfidence >= provisionalT
    ) {
      const verdict = await this.runAiVerifier(input);
      const accepted =
        verdict !== null &&
        verdict.decision === 'accept' &&
        (verdict.consensusType === 'unanimous' || verdict.consensusType === 'majority');
      this.metrics.incCurationVerifierVerdict({
        decision: verdict?.decision ?? 'unavailable',
        consensusType: verdict?.consensusType ?? 'unavailable',
      });
      if (accepted) {
        const version = await this.createInitialCardVersion(input, 'provisional');
        this.metrics.incCurationProvisional({ resourceType: input.resourceType });
        this.logger.log(
          {
            tenantId: input.tenantId,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            versionId: version.id,
            consensusType: verdict?.consensusType,
          },
          'curation.triage: provisional-canonical (AI-судья accept)',
        );
        const auditItemId = await this.maybeCreateAuditSample({
          input,
          settings,
          trustTier: 'provisional',
        });
        return {
          decision: 'provisional',
          cardVersionId: version.id,
          curationItemId: auditItemId,
          candidateCuratorIds: [],
        };
      }
      this.logger.log(
        {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          verdict: verdict?.decision ?? 'unavailable',
          consensusType: verdict?.consensusType ?? 'unavailable',
        },
        'curation.triage: AI-судья НЕ дал accept-консенсус → deep review (человек)',
      );
    }

    let level: CurationLevel;
    if (isCritical || conflict === 'hard' || effectiveConfidence < deepT) {
      level = 'deep';
    } else {
      level = 'light';
    }

    const triageReason = {
      confidence: input.confidence,
      calibratedConfidence:
        typeof input.calibratedConfidence === 'number' ? input.calibratedConfidence : null,
      effectiveConfidence,
      conflictSignal: conflict,
      conflictIds: input.conflictIds ?? [],
      criticalType: isCritical,
      autoThreshold: autoT,
      deepReviewThreshold: deepT,
      autoThresholdGlobal: settings.autoThreshold,
      deepThresholdGlobal: settings.deepReviewThreshold,
    };

    const candidates = await this.routing.resolveCurators({
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      level,
      criteria: input.criteria,
    });

    // Б56 (K4) — идемпотентность triage. При ретрае специалиста (BullMQ
    // attempts) повторный заход на тот же (resourceType, resourceId) плодил
    // дубль CurationItem → раздувание очереди «Подтверждения N». Guard:
    // если уже есть pending-item по этому ресурсу — переиспользуем его,
    // не создаём новый и не шлём повторный probe. (findFirst-guard, без
    // partial-unique: есть @@index([resourceType, resourceId]).)
    const existingPending = await this.prisma.curationItem.findFirst({
      where: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existingPending) {
      this.logger.log(
        {
          tenantId: input.tenantId,
          itemId: existingPending.id,
          level: existingPending.level,
        },
        'curation.triage: pending CurationItem уже существует — переиспользуем (idempotent)',
      );
      return {
        decision: existingPending.level,
        cardVersionId: null,
        curationItemId: existingPending.id,
        candidateCuratorIds: existingPending.candidateCuratorIds,
      };
    }

    const item = await this.prisma.curationItem.create({
      data: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        level,
        triageReason: triageReason as Prisma.InputJsonValue,
        proposedPayload: input.proposedPayload as Prisma.InputJsonValue,
        candidateCuratorIds: candidates,
        expiresAt: this.expiryDate(settings.itemExpiryDays),
      },
    });

    this.metrics.incCurationItem({
      resourceType: input.resourceType,
      level,
      status: 'pending',
    });

    await this.dispatchProbe({
      item,
      candidateCuratorIds: candidates,
      dataClass: input.dataClass,
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        itemId: item.id,
        level,
        candidates: candidates.length,
      },
      'curation.triage: создан CurationItem + dispatch probe',
    );

    return {
      decision: level,
      cardVersionId: null,
      curationItemId: item.id,
      candidateCuratorIds: candidates,
    };
  }

  async decide(input: DecideInput): Promise<CurationItem> {
    const item = await this.prisma.curationItem.findUnique({
      where: { id: input.curationItemId },
    });
    if (!item || item.tenantId !== input.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'curation_item_not_found',
          message: 'CurationItem не найден',
        },
      });
    }
    if (item.status !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'curation_item_not_pending',
          message: `CurationItem уже в статусе ${item.status}`,
        },
      });
    }

    if (
      item.candidateCuratorIds.length > 0 &&
      !item.candidateCuratorIds.includes(input.reviewerUserId)
    ) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          orgId_userId: { orgId: input.tenantId, userId: input.reviewerUserId },
        },
        select: { role: true },
      });
      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'not_in_candidates',
            message: 'Пользователь не назначен куратором для этой карточки',
          },
        });
      }
    }
    if (this.requiresReasoning(input.decisionType, item.level) && !input.reasoning) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'reasoning_required',
          message: 'reasoning обязателен для deep review и для split/merge/supersede',
        },
      });
    }

    if (input.decisionType === 'merge_categories') {
      const src = input.payload?.sourceCategoryId;
      const tgt = input.payload?.targetCategoryId;
      if (typeof src !== 'string' || typeof tgt !== 'string' || src === tgt) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'merge_categories_payload_required',
            message:
              'merge_categories требует payload.sourceCategoryId и payload.targetCategoryId (разные)',
          },
        });
      }
    }
    if (input.decisionType === 'escalate') {
      const next = input.payload?.escalateToUserId;
      if (typeof next !== 'string' || !next) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'escalate_user_required',
            message: 'escalate требует payload.escalateToUserId',
          },
        });
      }
    }

    const now = new Date();
    const isEscalate = input.decisionType === 'escalate';
    let createdDecisionId: string | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      const decision = await tx.curationDecision.create({
        data: {
          curationItemId: item.id,
          decisionType: input.decisionType as CurationDecisionType,
          payload: (input.payload ?? {}) as Prisma.InputJsonValue,
          reasoning: input.reasoning ?? null,
          reviewerUserId: input.reviewerUserId,
        },
      });
      createdDecisionId = decision.id;

      if (isEscalate) {
        const nextUserId = String(input.payload?.escalateToUserId);
        const candidates = item.candidateCuratorIds.includes(nextUserId)
          ? item.candidateCuratorIds
          : [...item.candidateCuratorIds, nextUserId];
        const updated = await tx.curationItem.update({
          where: { id: item.id },
          data: {
            assignedToUserId: nextUserId,
            candidateCuratorIds: candidates,
          },
        });
        return updated;
      }

      const updated = await tx.curationItem.update({
        where: { id: item.id },
        data: {
          status: 'decided',
          decidedAt: now,
          assignedToUserId: input.reviewerUserId,
        },
      });

      const writesCardVersion =
        input.decisionType === 'approve' ||
        input.decisionType === 'approve_with_edits' ||
        input.decisionType === 'split' ||
        input.decisionType === 'merge' ||
        input.decisionType === 'supersede';
      if (writesCardVersion) {
        const payloadForVersion =
          input.payload && Object.keys(input.payload).length > 0
            ? input.payload
            : (item.proposedPayload as Record<string, unknown>);
        await this.appendCardVersion(tx, {
          tenantId: item.tenantId,
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          payload: payloadForVersion,
          changeReason: input.decisionType,
          createdByUserId: input.reviewerUserId,
          curationDecisionId: decision.id,
          curationItemId: item.id,
          trustTier: 'human',
        });
      }

      return updated;
    });

    try {
      this.events?.emit('curation.decision_recorded', {
        tenantId: item.tenantId,
        curationItemId: item.id,
        curationDecisionId: createdDecisionId,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        decisionType: input.decisionType,
        reviewerUserId: input.reviewerUserId,
        reasoning: input.reasoning ?? null,
        proposedPayload: item.proposedPayload,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.decision_recorded emit failed (handled inside)',
      );
    }

    this.metrics.incCurationDecision({
      decisionType: input.decisionType,
      level: item.level,
    });
    if (!isEscalate) {
      this.metrics.incCurationItem({
        resourceType: item.resourceType,
        level: item.level,
        status: 'decided',
      });
      const seconds = Math.max(0, Math.floor((now.getTime() - item.createdAt.getTime()) / 1000));
      this.metrics.observeCurationTimeToDecide({ level: item.level, seconds });
    }

    this.logger.log(
      {
        tenantId: item.tenantId,
        itemId: item.id,
        decisionType: input.decisionType,
        reviewer: input.reviewerUserId,
        escalated: isEscalate,
      },
      isEscalate
        ? 'curation.decide: escalate — переназначено следующему куратору'
        : 'curation.decide: решение принято',
    );

    if (input.decisionType === 'merge_categories' && !isEscalate) {
      const sourceId = String(input.payload?.sourceCategoryId ?? '');
      const targetId = String(input.payload?.targetCategoryId ?? '');
      if (!this.skillCategories) {
        this.logger.warn(
          { itemId: item.id, sourceId, targetId },
          'curation.decide: merge_categories — SkillTraitCategoryService недоступен (worker-процесс?). Решение зафиксировано, merge не выполнен.',
        );
      } else if (sourceId && targetId) {
        try {
          await this.skillCategories.merge({
            tenantId: item.tenantId,
            userId: input.reviewerUserId,
            sourceId,
            targetId,
            reasoning: input.reasoning ?? null,
            via: 'curation_decision',
            curationDecisionId: createdDecisionId,
          });
        } catch (err) {
          this.logger.warn(
            {
              itemId: item.id,
              sourceId,
              targetId,
              err: err instanceof Error ? err.message : String(err),
            },
            'curation.decide: merge_categories handler упал (best-effort)',
          );
        }
      }
    }

    return result;
  }

  async recordDecision(
    input: RecordDecisionInput,
  ): Promise<{ curationItemId: string; curationDecisionId: string }> {
    if (!input.tenantId || !input.resourceType || !input.resourceId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_record_decision_input',
          message: 'tenantId / resourceType / resourceId обязательны для recordDecision',
        },
      });
    }
    if (!input.recordedBy) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'recorded_by_required',
          message: 'recordedBy (User.id) обязателен',
        },
      });
    }
    const proposedPayload = (input.context ?? {}) as Prisma.InputJsonValue;
    const triageReason = {
      via: 'recordDecision',
      reason: input.reason ?? null,
      taskType: input.taskType ?? null,
    };

    const now = new Date();
    const { item, decision } = await this.prisma.$transaction(async (tx) => {
      const createdItem = await tx.curationItem.create({
        data: {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          level: 'light',
          status: 'decided',
          assignedToUserId: input.recordedBy,
          triageReason: triageReason as Prisma.InputJsonValue,
          proposedPayload,
          decidedAt: now,
        },
      });
      const createdDecision = await tx.curationDecision.create({
        data: {
          curationItemId: createdItem.id,
          decisionType: input.decisionType as CurationDecisionType,
          payload: proposedPayload,
          reasoning: input.reason ?? null,
          reviewerUserId: input.recordedBy,
        },
      });
      return { item: createdItem, decision: createdDecision };
    });

    try {
      this.events?.emit('curation.decision_recorded', {
        tenantId: item.tenantId,
        curationItemId: item.id,
        curationDecisionId: decision.id,
        resourceType: item.resourceType,
        resourceId: item.resourceId,
        decisionType: input.decisionType,
        reviewerUserId: input.recordedBy,
        reasoning: input.reason ?? null,
        proposedPayload: item.proposedPayload,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.recordDecision emit failed (handled inside)',
      );
    }

    this.metrics.incCurationDecision({
      decisionType: input.decisionType,
      level: 'light',
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        itemId: item.id,
        decisionId: decision.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        decisionType: input.decisionType,
        recordedBy: input.recordedBy,
      },
      'curation.recordDecision: post-hoc решение зафиксировано',
    );

    return { curationItemId: item.id, curationDecisionId: decision.id };
  }

  async submitProposal(input: {
    tenantId: string;
    resourceType: string;
    resourceId: string;
    proposedPayload: Record<string, unknown>;
    submittedBy: string;
    reason?: string | null;
  }): Promise<{ curationItemId: string }> {
    if (!input.tenantId || !input.resourceType || !input.resourceId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_submit_proposal_input',
          message: 'tenantId / resourceType / resourceId обязательны для предложения правки',
        },
      });
    }
    if (!input.submittedBy) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'submitted_by_required',
          message: 'submittedBy (User.id) обязателен',
        },
      });
    }

    let candidateCuratorIds: string[] = [];
    try {
      candidateCuratorIds = await this.routing.resolveCurators({
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        level: 'light',
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.submitProposal: resolveCurators упал (best-effort, candidates=[])',
      );
    }

    const triageReason = {
      via: 'user_correction',
      reason: input.reason ?? null,
      submittedBy: input.submittedBy,
    };

    const item = await this.prisma.curationItem.create({
      data: {
        tenantId: input.tenantId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        level: 'light',
        status: 'pending',
        triageReason: triageReason as Prisma.InputJsonValue,
        proposedPayload: input.proposedPayload as Prisma.InputJsonValue,
        candidateCuratorIds,
      },
    });

    try {
      this.metrics.incCurationItem({
        resourceType: input.resourceType,
        level: 'light',
        status: 'pending',
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'curation.submitProposal: incCurationItem упал (best-effort)',
      );
    }

    this.logger.log(
      {
        tenantId: input.tenantId,
        itemId: item.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        submittedBy: input.submittedBy,
        candidateCuratorIds,
      },
      'curation.submitProposal: правка-предложение поставлена в очередь курации',
    );

    return { curationItemId: item.id };
  }

  async listQueue(args: {
    tenantId: string;
    requesterUserId: string;
    query: ListCurationQueueQuery;
  }): Promise<ListCurationQueueResponse> {
    const { tenantId, requesterUserId, query } = args;
    const where: Prisma.CurationItemWhereInput = { tenantId };
    if (query.level) where.level = query.level;
    if (query.status) where.status = query.status;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.resourceId) where.resourceId = query.resourceId;
    if (query.assignedToMe) {
      where.OR = [
        { assignedToUserId: requesterUserId },
        { candidateCuratorIds: { has: requesterUserId } },
      ];
    }

    if (query.limit === 0) {
      const total = await this.prisma.curationItem.count({ where });
      return { items: [], total, page: 1, limit: 0, totalPages: 0 };
    }

    const [items, total] = await Promise.all([
      this.prisma.curationItem.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.curationItem.count({ where }),
    ]);
    return {
      items: items.map((i) => this.toItemDto(i)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, query.limit))),
    };
  }

  async getItemById(args: { tenantId: string; id: string }): Promise<CurationItemDetailDto> {
    const item = await this.prisma.curationItem.findUnique({
      where: { id: args.id },
      include: {
        decisions: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!item || item.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'curation_item_not_found',
          message: 'CurationItem не найден',
        },
      });
    }
    const conflicts = await this.prisma.conflictItem.findMany({
      where: {
        tenantId: args.tenantId,
        resourceType: item.resourceType,
        status: 'open',
        OR: [{ existingId: item.resourceId }, { newId: item.resourceId }],
      },
      select: { id: true },
    });
    return {
      ...this.toItemDto(item),
      decisions: item.decisions.map((d) => this.toDecisionDto(d)),
      relatedConflictIds: conflicts.map((c) => c.id),
    };
  }

  async getOverrideStats(args: { tenantId: string }): Promise<OverrideStatsResponse> {
    const items = await this.prisma.curationItem.findMany({
      where: { tenantId: args.tenantId },
      select: {
        resourceType: true,
        decisions: { select: { decisionType: true, createdAt: true } },
      },
    });

    interface Acc {
      totalDecided: number;
      approve: number;
      approveWithEdits: number;
      reject: number;
      other: number;
    }
    const byType = items.reduce<Map<string, Acc>>((map, item) => {
      const finalDecision = item.decisions
        .filter((d) => d.decisionType !== 'escalate')
        .reduce<{ decisionType: string; createdAt: Date } | null>((latest, d) => {
          if (!latest || d.createdAt.getTime() > latest.createdAt.getTime()) {
            return d;
          }
          return latest;
        }, null);
      if (!finalDecision) return map;

      const acc = map.get(item.resourceType) ?? {
        totalDecided: 0,
        approve: 0,
        approveWithEdits: 0,
        reject: 0,
        other: 0,
      };
      acc.totalDecided += 1;
      switch (finalDecision.decisionType) {
        case 'approve':
          acc.approve += 1;
          break;
        case 'approve_with_edits':
          acc.approveWithEdits += 1;
          break;
        case 'reject':
          acc.reject += 1;
          break;
        default:
          acc.other += 1;
          break;
      }
      map.set(item.resourceType, acc);
      return map;
    }, new Map());

    const result: OverrideStatsItemDto[] = [...byType.entries()].map(([resourceType, acc]) => ({
      resourceType,
      totalDecided: acc.totalDecided,
      approve: acc.approve,
      approveWithEdits: acc.approveWithEdits,
      reject: acc.reject,
      other: acc.other,
      overrideRate:
        acc.totalDecided > 0 ? (acc.reject + acc.approveWithEdits) / acc.totalDecided : 0,
    }));
    result.sort((a, b) => a.resourceType.localeCompare(b.resourceType));
    return { items: result };
  }

  async getProvisionalAuditStats(args: {
    tenantId: string;
  }): Promise<ProvisionalAuditStatsResponse> {
    const items = await this.prisma.curationItem.findMany({
      where: { tenantId: args.tenantId, status: 'decided' },
      select: {
        resourceType: true,
        triageReason: true,
        decisions: { select: { decisionType: true, createdAt: true } },
      },
    });

    const WRONG_TYPES = new Set(['reject', 'mark_as_misleading', 'supersede']);
    interface Acc {
      auditDecided: number;
      auditWrong: number;
    }
    const byType = items.reduce<Map<string, Acc>>((map, item) => {
      if (!this.isAuditSample(item.triageReason)) return map;

      const finalDecision = item.decisions
        .filter((d) => d.decisionType !== 'escalate')
        .reduce<{ decisionType: string; createdAt: Date } | null>((latest, d) => {
          if (!latest || d.createdAt.getTime() > latest.createdAt.getTime()) {
            return d;
          }
          return latest;
        }, null);
      if (!finalDecision) return map;

      const acc = map.get(item.resourceType) ?? { auditDecided: 0, auditWrong: 0 };
      acc.auditDecided += 1;
      if (WRONG_TYPES.has(finalDecision.decisionType)) acc.auditWrong += 1;
      map.set(item.resourceType, acc);
      return map;
    }, new Map());

    const result: ProvisionalAuditStatsItemDto[] = [...byType.entries()].map(
      ([resourceType, acc]) => ({
        resourceType,
        auditDecided: acc.auditDecided,
        auditWrong: acc.auditWrong,
        provisionalWrongRate: acc.auditDecided > 0 ? acc.auditWrong / acc.auditDecided : 0,
      }),
    );
    result.sort((a, b) => a.resourceType.localeCompare(b.resourceType));
    return { items: result };
  }

  private isAuditSample(reason: Prisma.JsonValue): boolean {
    return (
      !!reason &&
      typeof reason === 'object' &&
      !Array.isArray(reason) &&
      (reason as Record<string, unknown>).reason === 'audit_sample'
    );
  }

  async getSettings(tenantId: string): Promise<CurationSettingsDto> {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { curationSettings: true },
    });
    return this.normalizeSettings(org?.curationSettings ?? null);
  }

  async updateSettings(args: {
    tenantId: string;
    patch: UpdateCurationSettingsBody;
  }): Promise<CurationSettingsDto> {
    const current = await this.getSettings(args.tenantId);
    const autoByType = this.normalizeThresholdMap(
      args.patch.autoThresholdByType ?? current.autoThresholdByType ?? {},
    );
    const deepByType = this.normalizeThresholdMap(
      args.patch.deepReviewThresholdByType ?? current.deepReviewThresholdByType ?? {},
    );
    const provisionalByType = this.normalizeThresholdMap(
      args.patch.provisionalThresholdByType ?? current.provisionalThresholdByType ?? {},
    );
    const next: CurationSettingsDto = {
      autoThreshold: args.patch.autoThreshold ?? current.autoThreshold,
      deepReviewThreshold: args.patch.deepReviewThreshold ?? current.deepReviewThreshold,
      criticalTypes: args.patch.criticalTypes ?? current.criticalTypes,
      itemExpiryDays: args.patch.itemExpiryDays ?? current.itemExpiryDays,
      autoThresholdByType: autoByType,
      deepReviewThresholdByType: deepByType,
      provisionalThreshold: args.patch.provisionalThreshold ?? current.provisionalThreshold,
      provisionalThresholdByType: provisionalByType,
      aiVerifierEnabled: args.patch.aiVerifierEnabled ?? current.aiVerifierEnabled,
      auditSampleRate: args.patch.auditSampleRate ?? current.auditSampleRate,
      autotuneEnabled: args.patch.autotuneEnabled ?? current.autotuneEnabled,
      thresholdMin: args.patch.thresholdMin ?? current.thresholdMin,
      thresholdMax: args.patch.thresholdMax ?? current.thresholdMax,
      autotuneStep: args.patch.autotuneStep ?? current.autotuneStep,
      minDecisionsForAutotune:
        args.patch.minDecisionsForAutotune ?? current.minDecisionsForAutotune,
      maxProvisionalOverride: args.patch.maxProvisionalOverride ?? current.maxProvisionalOverride,
    };
    if (next.autoThreshold < next.deepReviewThreshold) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_thresholds',
          message:
            'autoThreshold должен быть >= deepReviewThreshold (иначе triage не имеет «light» окна)',
        },
      });
    }
    for (const [type, autoVal] of Object.entries(autoByType)) {
      const deepVal = deepByType[type];
      if (deepVal !== undefined && autoVal < deepVal) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'invalid_thresholds',
            message: `autoThresholdByType[${type}] должен быть >= deepReviewThresholdByType[${type}]`,
          },
        });
      }
    }
    await this.prisma.org.update({
      where: { id: args.tenantId },
      data: { curationSettings: next as unknown as Prisma.InputJsonValue },
    });
    return next;
  }

  private requiresReasoning(decisionType: CurationDecisionTypeDto, level: CurationLevel): boolean {
    if (level === 'deep') return true;
    return (
      decisionType === 'split' ||
      decisionType === 'merge' ||
      decisionType === 'supersede' ||
      decisionType === 'merge_categories' ||
      decisionType === 'escalate'
    );
  }

  private async createInitialCardVersion(input: TriageInput, trustTier: TrustTier) {
    return this.appendCardVersion(this.prisma, {
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      payload: input.proposedPayload,
      changeReason: 'initial',
      createdByUserId: input.createdByUserId ?? null,
      curationDecisionId: null,
      curationItemId: null,
      trustTier,
    });
  }

  private async runAiVerifier(input: TriageInput): Promise<DebateVerdict | null> {
    if (!this.debate) return null;
    try {
      const verdict = await this.debate.judge({
        taskFamily: 'curation-verify',
        taskType: 'debate-curation-verify',
        task: `Карточка ${input.resourceType} корректна, обоснована и должна быть канонизирована в память компании? Verdict строго: accept | reject.`,
        candidates: [{ resourceType: input.resourceType, candidate: input.proposedPayload }],
        contextBlocks: [],
        tenantId: input.tenantId,
      });
      if (verdict.fallbackUsed === 'provider_unavailable' && verdict.votes.length === 0) {
        return null;
      }
      return verdict;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: input.tenantId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'curation.runAiVerifier: debate.judge упал — fallback к человеку (deep)',
      );
      return null;
    }
  }

  private async maybeCreateAuditSample(args: {
    input: TriageInput;
    settings: CurationSettingsDto;
    trustTier: TrustTier;
  }): Promise<string | null> {
    const rate = args.settings.auditSampleRate ?? DEFAULT_AUDIT_SAMPLE_RATE;
    if (!this.shouldSample(rate)) return null;
    try {
      const candidates = await this.routing.resolveCurators({
        tenantId: args.input.tenantId,
        resourceType: args.input.resourceType,
        level: 'light',
        criteria: args.input.criteria,
      });
      const item = await this.prisma.curationItem.create({
        data: {
          tenantId: args.input.tenantId,
          resourceType: args.input.resourceType,
          resourceId: args.input.resourceId,
          level: 'light',
          status: 'pending',
          triageReason: {
            reason: 'audit_sample',
            trustTier: args.trustTier,
            auditSampleRate: rate,
          } as Prisma.InputJsonValue,
          proposedPayload: args.input.proposedPayload as Prisma.InputJsonValue,
          candidateCuratorIds: candidates,
          expiresAt: this.expiryDate(args.settings.itemExpiryDays),
        },
      });
      this.metrics.incCurationItem({
        resourceType: args.input.resourceType,
        level: 'light',
        status: 'pending',
      });
      this.metrics.incCurationAuditSample({ resourceType: args.input.resourceType });
      await this.dispatchProbe({
        item,
        candidateCuratorIds: candidates,
        dataClass: args.input.dataClass,
      });
      this.logger.log(
        {
          tenantId: args.input.tenantId,
          itemId: item.id,
          resourceType: args.input.resourceType,
          trustTier: args.trustTier,
        },
        'curation.triage: создан аудит-CurationItem (audit_sample, не блокирует)',
      );
      return item.id;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.input.tenantId,
          resourceType: args.input.resourceType,
          err: err instanceof Error ? err.message : String(err),
        },
        'curation.maybeCreateAuditSample: не удалось создать аудит-item (best-effort)',
      );
      return null;
    }
  }

  private shouldSample(rate: number): boolean {
    if (!Number.isFinite(rate) || rate <= 0) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
  }

  private async appendCardVersion(
    db: PrismaService | Prisma.TransactionClient,
    args: {
      tenantId: string;
      resourceType: string;
      resourceId: string;
      payload: Record<string, unknown>;
      changeReason: string;
      createdByUserId: string | null;
      curationDecisionId: string | null;
      curationItemId: string | null;
      trustTier?: TrustTier;
    },
  ) {
    const last = await db.cardVersion.findFirst({
      where: { resourceType: args.resourceType, resourceId: args.resourceId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const created = await db.cardVersion.create({
      data: {
        tenantId: args.tenantId,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        version,
        previousVersionId: last?.id ?? null,
        payload: args.payload as Prisma.InputJsonValue,
        changeReason: args.changeReason,
        createdByUserId: args.createdByUserId,
        curationDecisionId: args.curationDecisionId,
        curationItemId: args.curationItemId,
        trustTier: args.trustTier ?? 'human',
      },
    });
    try {
      this.events?.emit('card-version.created', {
        tenantId: args.tenantId,
        cardVersionId: created.id,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
      });
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'card-version.created emit failed (handled inside)',
      );
    }
    return created;
  }

  private expiryDate(days: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }

  private async dispatchProbe(args: {
    item: CurationItem;
    candidateCuratorIds: string[];
    dataClass?: 'public' | 'internal' | 'sensitive' | 'private';
  }): Promise<void> {
    const { item, candidateCuratorIds } = args;
    const summary = this.buildProbeSummary(item);
    const actionUrl = `/curation/${item.id}`;
    const dataClass = args.dataClass ?? 'internal';

    for (const userId of candidateCuratorIds) {
      try {
        await this.conversational.sendNotification({
          tenantId: item.tenantId,
          recipientUserId: userId,
          eventType: 'curation.pending',
          payload: {
            resourceType: item.resourceType,
            resourceId: item.resourceId,
            summary,
            confidence: this.extractConfidenceFromReason(item.triageReason),
            actionUrl,
          },
          dataClass,
          contextCardId: item.resourceId,
          expiresAt: item.expiresAt ? item.expiresAt.toISOString() : undefined,
        });

        if (item.level === 'deep') {
          await this.conversational.sendNotification({
            tenantId: item.tenantId,
            recipientUserId: userId,
            eventType: 'system.message',
            payload: {
              title: 'Карточка требует подробной проверки',
              body: summary,
              severity: 'warning',
              actionUrl,
            },
            dataClass,
            contextCardId: item.resourceId,
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: item.tenantId,
            itemId: item.id,
            userId,
            err: err instanceof Error ? err.message : String(err),
          },
          'curation: ошибка dispatchProbe — пропускаю получателя',
        );
      }
    }
  }

  private buildProbeSummary(item: CurationItem): string {
    const conf = this.extractConfidenceFromReason(item.triageReason);
    const confText = conf !== undefined ? ` (уверенность ${(conf * 100).toFixed(0)}%)` : '';
    return `На проверке карточка «${resourceTypeRu(item.resourceType)}»${confText} — уровень: ${levelRu(item.level)}.`;
  }

  private extractConfidenceFromReason(reason: Prisma.JsonValue): number | undefined {
    if (reason && typeof reason === 'object' && !Array.isArray(reason) && 'confidence' in reason) {
      const v = (reason as Record<string, unknown>).confidence;
      if (typeof v === 'number') return v;
    }
    return undefined;
  }

  private normalizeSettings(raw: Prisma.JsonValue | null): CurationSettingsDto {
    const def: CurationSettingsDto = {
      autoThreshold: this.cfg.curation.autoThresholdDefault ?? DEFAULT_AUTO_THRESHOLD,
      deepReviewThreshold:
        this.cfg.curation.deepReviewThresholdDefault ?? DEFAULT_DEEP_REVIEW_THRESHOLD,
      criticalTypes: (this.cfg.curation.criticalTypesDefault as readonly string[])?.slice() ?? [
        ...DEFAULT_CRITICAL_TYPES,
      ],
      itemExpiryDays: this.cfg.curation.itemExpiryDays ?? 30,
      autoThresholdByType: {},
      deepReviewThresholdByType: {},
      provisionalThreshold: this.cfg.curation.provisionalThresholdDefault,
      provisionalThresholdByType: {},
      aiVerifierEnabled: this.cfg.curation.aiVerifierEnabled,
      auditSampleRate: this.cfg.curation.auditSampleRate,
      autotuneEnabled: this.cfg.curation.autotuneEnabled,
      thresholdMin: this.cfg.curation.thresholdMin,
      thresholdMax: this.cfg.curation.thresholdMax,
      autotuneStep: this.cfg.curation.autotuneStep,
      minDecisionsForAutotune: this.cfg.curation.minDecisionsForAutotune,
      maxProvisionalOverride: this.cfg.curation.maxProvisionalOverride,
    };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
    const obj = raw as Record<string, unknown>;
    return {
      autoThreshold: typeof obj.autoThreshold === 'number' ? obj.autoThreshold : def.autoThreshold,
      deepReviewThreshold:
        typeof obj.deepReviewThreshold === 'number'
          ? obj.deepReviewThreshold
          : def.deepReviewThreshold,
      criticalTypes: Array.isArray(obj.criticalTypes)
        ? (obj.criticalTypes.filter((s): s is string => typeof s === 'string') as string[])
        : def.criticalTypes,
      itemExpiryDays:
        typeof obj.itemExpiryDays === 'number' ? obj.itemExpiryDays : def.itemExpiryDays,
      autoThresholdByType: this.normalizeThresholdMap(obj.autoThresholdByType),
      deepReviewThresholdByType: this.normalizeThresholdMap(obj.deepReviewThresholdByType),
      provisionalThreshold:
        typeof obj.provisionalThreshold === 'number' &&
        Number.isFinite(obj.provisionalThreshold) &&
        obj.provisionalThreshold >= 0 &&
        obj.provisionalThreshold <= 1
          ? obj.provisionalThreshold
          : def.provisionalThreshold,
      provisionalThresholdByType: this.normalizeThresholdMap(obj.provisionalThresholdByType),
      aiVerifierEnabled:
        typeof obj.aiVerifierEnabled === 'boolean' ? obj.aiVerifierEnabled : def.aiVerifierEnabled,
      auditSampleRate:
        typeof obj.auditSampleRate === 'number' &&
        Number.isFinite(obj.auditSampleRate) &&
        obj.auditSampleRate >= 0 &&
        obj.auditSampleRate <= 1
          ? obj.auditSampleRate
          : def.auditSampleRate,
      autotuneEnabled:
        typeof obj.autotuneEnabled === 'boolean' ? obj.autotuneEnabled : def.autotuneEnabled,
      thresholdMin: this.parseUnit(obj.thresholdMin, def.thresholdMin),
      thresholdMax: this.parseUnit(obj.thresholdMax, def.thresholdMax),
      autotuneStep: this.parseUnit(obj.autotuneStep, def.autotuneStep),
      minDecisionsForAutotune:
        typeof obj.minDecisionsForAutotune === 'number' &&
        Number.isInteger(obj.minDecisionsForAutotune) &&
        obj.minDecisionsForAutotune >= 1
          ? obj.minDecisionsForAutotune
          : def.minDecisionsForAutotune,
      maxProvisionalOverride: this.parseUnit(
        obj.maxProvisionalOverride,
        def.maxProvisionalOverride,
      ),
    };
  }

  private parseUnit(raw: unknown, fallback: number | undefined): number | undefined {
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
  }

  private normalizeThresholdMap(raw: unknown): Record<string, number> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const type = key.trim();
      if (
        type.length >= 1 &&
        type.length <= 80 &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      ) {
        out[type] = value;
      }
    }
    return out;
  }

  private toItemDto(item: CurationItem): CurationItemDto {
    return {
      id: item.id,
      tenantId: item.tenantId,
      resourceType: item.resourceType,
      resourceId: item.resourceId,
      level: item.level as CurationLevelDto,
      triageReason: jsonObj(item.triageReason),
      proposedPayload: jsonObj(item.proposedPayload),
      status: item.status,
      assignedToUserId: item.assignedToUserId,
      candidateCuratorIds: item.candidateCuratorIds,
      createdAt: item.createdAt.toISOString(),
      decidedAt: item.decidedAt ? item.decidedAt.toISOString() : null,
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
    };
  }

  private toDecisionDto(d: {
    id: string;
    curationItemId: string;
    decisionType: CurationDecisionType;
    payload: Prisma.JsonValue;
    reasoning: string | null;
    reviewerUserId: string;
    createdAt: Date;
  }): CurationDecisionDto {
    return {
      id: d.id,
      curationItemId: d.curationItemId,
      decisionType: d.decisionType as CurationDecisionTypeDto,
      payload: jsonObj(d.payload),
      reasoning: d.reasoning,
      reviewerUserId: d.reviewerUserId,
      createdAt: d.createdAt.toISOString(),
    };
  }
}

function jsonObj(v: Prisma.JsonValue): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}
