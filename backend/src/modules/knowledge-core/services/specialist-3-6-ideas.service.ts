import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type DataClass,
  type Idea,
  type IdeaBlock,
  type IdeaBlockEvidence,
  type IdeaKind,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { CurationService } from '../../curation/services/curation.service';
import {
  IDEA_EXTRACT_JSON_SCHEMA,
  IDEA_EXTRACT_SCHEMA_NAME,
  IDEA_EXTRACT_SYSTEM_PROMPT,
  IDEA_EXTRACT_USER_TEMPLATE,
} from '../prompts/idea-extract.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';
import { KnowledgeEmbeddingService } from './embedding.service';

interface IdeaSupporter {
  kind: 'person' | 'customer';
  entityId: string;
  firstSupportedAt: string;
  blockId?: string;
}

interface IdeaDraft {
  kind: 'internal' | 'client_request';
  statement: string;
  rationale?: string | null;
  confidence: number;
}

/**
 * SBA β-5 — Specialist36Service (Specialist 3.6 — Ideas Collector).
 *
 * Обрабатывает блок с signalType ∈ {idea, feature_request}:
 *   1. embedding → KNN top-10 existing Idea (threshold IDEA_CLUSTER_THRESHOLD).
 *   2. Match → update existing (добавить supporter / sourceBlockId / weight).
 *   3. Miss  → LLM idea-extract → resolve supporters → CurationService.triage
 *      → create Idea (статус 'captured'); EventEmitter 'idea.created'.
 *
 * Веc идеи: `supporterCount * 1.0 + recency_factor * 0.5 + specificity_factor`.
 */
@Injectable()
export class Specialist36Service {
  private readonly logger = new Logger(Specialist36Service.name);

  static readonly SPECIALIST_NAME = '3-6-ideas';
  private static readonly KNN_TOP_K = 10;
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;
  private static readonly AUTO_CONFIDENCE_THRESHOLD = 0.85;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    // W4.1 — DataClassPolicyService для shadow-compare.
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async processBlock(args: {
    tenantId: string;
    blockId: string;
  }): Promise<void> {
    const block = await this.prisma.ideaBlock.findUnique({
      where: { id: args.blockId },
      include: { evidence: true },
    });
    if (!block) return;
    if (block.tenantId !== args.tenantId) return;
    const allowed = new Set(['idea', 'feature_request']);
    if (!allowed.has(block.signalType)) return;

    try {
      const queryText = this.buildQueryText(block);
      const matched = await this.findMatchingIdea({
        tenantId: block.tenantId,
        queryText,
      });
      if (matched) {
        await this.updateExistingIdea({ existing: matched, block });
        return;
      }

      const draft = await this.extractDraft(block);
      if (!draft) return;

      // Resolve supporters and ownerUserId.
      const { supporters, ownerUserId } = await this.resolveSupportersAndOwner({
        tenantId: block.tenantId,
        blockId: block.id,
        kind: draft.kind,
      });

      const weight = this.computeWeight({
        supporterCount: supporters.length,
        recencyDate: block.createdAt,
        hasRationale: Boolean(draft.rationale),
      });

      // W4.1/W4.2 — derive DataClass.
      // legacy = block.dataClass (passthrough); proposed — derive с
      // floor=internal по kind='idea'. На 'enforce' — пишем derive + audit;
      // иначе legacy.
      const legacyDc = block.dataClass;
      const enforcement = this.cfg?.dataClassPolicy.enforcement ?? 'off';
      const proposed = this.dataClassPolicy?.derive({
        sources: [
          {
            dataClass: block.dataClass,
            sourceId: block.id,
            sourceKind: 'idea_block',
          },
        ],
        context: { kind: 'idea' },
      });
      if (this.dataClassPolicy && proposed) {
        this.dataClassPolicy.compareWithLegacy({
          legacyResult: legacyDc,
          proposedResult: proposed.dataClass,
          kind: 'idea',
          sourceIds: [block.id],
        });
      }
      const finalDc =
        enforcement === 'enforce' && proposed ? proposed.dataClass : legacyDc;
      const audit =
        enforcement === 'enforce' && proposed
          ? (proposed.audit as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull;

      const idea = await this.prisma.idea.create({
        data: {
          tenantId: block.tenantId,
          kind: draft.kind as IdeaKind,
          statement: draft.statement,
          rationale: draft.rationale ?? null,
          weight: new Prisma.Decimal(weight),
          supporterCount: Math.max(1, supporters.length),
          supporters: supporters as unknown as Prisma.InputJsonValue,
          firstProposedAt: block.createdAt,
          lastDiscussedAt: block.createdAt,
          status: 'captured',
          sourceBlockIds: [block.id],
          personSubjectIds: supporters
            .filter((s) => s.kind === 'person')
            .map((s) => s.entityId),
          confidence: new Prisma.Decimal(
            Math.max(0, Math.min(1, draft.confidence)),
          ),
          dataClass: finalDc,
          dataClassAudit: audit,
          createdByUserId: ownerUserId,
        },
      });

      await this.tryWriteEmbedding({ id: idea.id, text: queryText });

      // Triage (idea НЕ в critical-types — auto при confidence>=0.85).
      await this.triageProposed({
        tenantId: block.tenantId,
        resourceId: idea.id,
        confidence: draft.confidence,
        proposedPayload: {
          kind: idea.kind,
          statement: idea.statement,
          rationale: idea.rationale,
          supporters: idea.supporters,
          weight: weight,
          sourceBlockIds: idea.sourceBlockIds,
        },
        dataClass: idea.dataClass,
      });

      this.metrics.incCoreSpecialistCards({
        type: 'idea',
        status: 'captured',
      });

      // EventEmitter — 'idea.created' (для последующих cron'ов / аналитики).
      try {
        this.events.emit('idea.created', {
          tenantId: idea.tenantId,
          ideaId: idea.id,
          kind: idea.kind,
        });
      } catch {
        // graceful
      }

      // Постановка в очередь idea-clusterer (1 job в минуту на Org).
      try {
        await this.coreQueue.enqueueIdeaClusterer({ tenantId: block.tenantId });
      } catch {
        // graceful
      }
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'idea',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6.processBlock: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  /**
   * Изменить статус идеи. Вызывается из IdeasController (POST /ideas/:id/status).
   * Создаёт CardVersion, обновляет Idea и эмитит EventEmitter
   * 'idea.status_changed' для closing-loop handler'а.
   */
  async changeStatus(args: {
    tenantId: string;
    ideaId: string;
    newStatus: Idea['status'];
    reason: string | null;
    changedByUserId: string;
  }): Promise<Idea> {
    const existing = await this.prisma.idea.findFirst({
      where: { id: args.ideaId, tenantId: args.tenantId },
    });
    if (!existing) {
      throw new Error('idea_not_found');
    }
    const oldStatus = existing.status;
    if (oldStatus === args.newStatus) return existing;

    const updated = await this.prisma.idea.update({
      where: { id: existing.id },
      data: {
        status: args.newStatus,
        statusChangedAt: new Date(),
        statusChangedByUserId: args.changedByUserId,
        statusReason: args.reason,
      },
    });

    // EventEmitter — для closing-loop handler'а.
    try {
      this.events.emit('idea.status_changed', {
        tenantId: existing.tenantId,
        ideaId: existing.id,
        oldStatus,
        newStatus: args.newStatus,
        reason: args.reason,
        changedByUserId: args.changedByUserId,
      });
    } catch {
      // graceful
    }

    return updated;
  }

  // ─────────────────────────── KNN / update ─────────────────────────────

  private async findMatchingIdea(args: {
    tenantId: string;
    queryText: string;
  }): Promise<Idea | null> {
    const text = args.queryText.trim().slice(0, 2_000);
    if (!text) return null;
    let embedding: number[] | null = null;
    try {
      embedding = await this.embedder.embedQuery(text);
    } catch {
      return null;
    }
    if (!embedding) return null;
    const threshold = this.cfg.ideas.clusterThreshold;
    try {
      const vec = `[${embedding.join(',')}]`;
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; distance: number }>
      >(
        `SELECT "id", ("embedding" <=> $2::vector) AS distance
         FROM "ideas"
         WHERE "tenantId" = $1
           AND "embedding" IS NOT NULL
           AND "status" NOT IN ('rejected','archived')
         ORDER BY "embedding" <=> $2::vector
         LIMIT ${Specialist36Service.KNN_TOP_K}`,
        args.tenantId,
        vec,
      );
      if (rows.length === 0) return null;
      const best = rows[0];
      if (!best) return null;
      const sim = 1 - Number(best.distance);
      if (sim < threshold) return null;
      const full = await this.prisma.idea.findFirst({
        where: { id: best.id, tenantId: args.tenantId },
      });
      return full;
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6.findMatchingIdea: pgvector KNN упал — пропускаю',
      );
      return null;
    }
  }

  private async updateExistingIdea(args: {
    existing: Idea;
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] };
  }): Promise<void> {
    // Добавим supporter (если новый Person/Customer).
    const newSourceBlockIds = Array.from(
      new Set([...args.existing.sourceBlockIds, args.block.id]),
    );
    const { supporters: newSupporters } = await this.resolveSupportersAndOwner({
      tenantId: args.block.tenantId,
      blockId: args.block.id,
      kind: args.existing.kind,
    });
    const existingSupporters = this.parseSupporters(args.existing.supporters);
    const merged = this.mergeSupporters(existingSupporters, newSupporters);
    const weight = this.computeWeight({
      supporterCount: merged.length,
      recencyDate: new Date(),
      hasRationale: Boolean(args.existing.rationale),
    });
    await this.prisma.idea.update({
      where: { id: args.existing.id },
      data: {
        sourceBlockIds: { set: newSourceBlockIds },
        supporters: merged as unknown as Prisma.InputJsonValue,
        supporterCount: merged.length,
        weight: new Prisma.Decimal(weight),
        lastDiscussedAt: new Date(),
      },
    });
  }

  // ─────────────────────────── LLM extract ─────────────────────────────

  private async extractDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
  ): Promise<IdeaDraft | null> {
    const start = Date.now();
    const quotes = block.evidence
      .slice(0, 6)
      .map((e) => e.quote)
      .filter((q) => q && q.length > 0);
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (контент блока) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = IDEA_EXTRACT_USER_TEMPLATE({
      blockName: block.name,
      criticalQuestion: block.criticalQuestion,
      trustedAnswer: block.trustedAnswer,
      signalType: block.signalType,
      tags: block.tags,
      evidenceQuotes: quotes,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'idea-extract',
        systemPrompt: guardOn
          ? withInjectionGuard(IDEA_EXTRACT_SYSTEM_PROMPT)
          : IDEA_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: IDEA_EXTRACT_SCHEMA_NAME,
          schema: IDEA_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: block.id },
        dataClass: block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'idea',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6.extractDraft: LLM упал — skip',
      );
      return null;
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'idea',
        seconds: (Date.now() - start) / 1000,
      });
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'idea',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: IdeaDraft | null;
    try {
      parsed = JSON.parse(result.text) as IdeaDraft;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'idea',
        reason: 'json_parse',
      });
      return null;
    }
    if (!parsed || !parsed.statement || !parsed.kind) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'idea',
        reason: 'schema_validation',
      });
      return null;
    }
    if (parsed.confidence < Specialist36Service.MIN_EXTRACT_CONFIDENCE) {
      return null;
    }
    return parsed;
  }

  // ─────────────────────────── helpers ─────────────────────────────────

  private async resolveSupportersAndOwner(args: {
    tenantId: string;
    blockId: string;
    kind: 'internal' | 'client_request';
  }): Promise<{ supporters: IdeaSupporter[]; ownerUserId: string | null }> {
    const supporters: IdeaSupporter[] = [];
    let ownerUserId: string | null = null;

    if (args.kind === 'internal') {
      // subject-Person с relationship='employee' → supporter person.
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: args.blockId,
          role: 'subject',
          entity: { type: 'person' },
        },
        select: { entityId: true },
      });
      const employees = await this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          entityId: { in: mentions.map((m) => m.entityId) },
          relationship: 'employee',
          deletedAt: null,
        },
        select: { id: true, entityId: true, userId: true },
      });
      for (const p of employees) {
        if (!p.entityId) continue;
        supporters.push({
          kind: 'person',
          entityId: p.entityId,
          firstSupportedAt: new Date().toISOString(),
          blockId: args.blockId,
        });
        if (!ownerUserId && p.userId) ownerUserId = p.userId;
      }
    } else {
      // client_request — mentioned Customer entities.
      const mentions = await this.prisma.ideaBlockEntity.findMany({
        where: {
          blockId: args.blockId,
          entity: { type: { in: ['customer', 'client'] } },
        },
        select: { entityId: true },
      });
      for (const m of mentions) {
        supporters.push({
          kind: 'customer',
          entityId: m.entityId,
          firstSupportedAt: new Date().toISOString(),
          blockId: args.blockId,
        });
      }
    }
    return { supporters, ownerUserId };
  }

  private parseSupporters(payload: Prisma.JsonValue): IdeaSupporter[] {
    if (!Array.isArray(payload)) return [];
    const arr = payload as Array<Prisma.JsonValue>;
    const result: IdeaSupporter[] = [];
    for (const item of arr) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) {
        continue;
      }
      const s = item as Record<string, Prisma.JsonValue>;
      const kindRaw = typeof s.kind === 'string' ? s.kind : 'person';
      const kind: IdeaSupporter['kind'] =
        kindRaw === 'customer' ? 'customer' : 'person';
      const entityId = typeof s.entityId === 'string' ? s.entityId : '';
      if (entityId.length === 0) continue;
      const firstSupportedAt =
        typeof s.firstSupportedAt === 'string'
          ? s.firstSupportedAt
          : new Date().toISOString();
      const dto: IdeaSupporter = { kind, entityId, firstSupportedAt };
      if (typeof s.blockId === 'string') dto.blockId = s.blockId;
      result.push(dto);
    }
    return result;
  }

  private mergeSupporters(
    existing: IdeaSupporter[],
    incoming: IdeaSupporter[],
  ): IdeaSupporter[] {
    const seen = new Map<string, IdeaSupporter>();
    for (const s of [...existing, ...incoming]) {
      const key = `${s.kind}:${s.entityId}`;
      if (!seen.has(key)) seen.set(key, s);
    }
    return [...seen.values()];
  }

  private computeWeight(args: {
    supporterCount: number;
    recencyDate: Date;
    hasRationale: boolean;
  }): number {
    const days = Math.max(
      0,
      (Date.now() - args.recencyDate.getTime()) / (1000 * 86400),
    );
    const recencyFactor = Math.max(0.1, 1 - days / 60); // декей за 60 дней.
    const specificityFactor = args.hasRationale ? 1 : 0.5;
    const base = Math.max(1, args.supporterCount) * 1.0;
    const value = base + recencyFactor * 0.5 + specificityFactor;
    return Math.round(value * 1000) / 1000;
  }

  private buildQueryText(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
  ): string {
    const parts = [block.name, block.trustedAnswer]
      .filter((s) => s && s.length > 0)
      .join('. ');
    return parts.slice(0, 2_000);
  }

  private async triageProposed(args: {
    tenantId: string;
    resourceId: string;
    confidence: number;
    proposedPayload: Record<string, unknown>;
    dataClass: DataClass;
  }): Promise<void> {
    try {
      await this.curation.triage({
        tenantId: args.tenantId,
        resourceType: 'idea',
        resourceId: args.resourceId,
        confidence: Math.min(1, Math.max(0, args.confidence)),
        proposedPayload: args.proposedPayload,
        conflictSignal: 'none',
        createdByUserId: null,
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.logger.warn(
        {
          ideaId: args.resourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6.triage: упал — карточка без CurationItem',
      );
    }
  }

  private async tryWriteEmbedding(args: {
    id: string;
    text: string;
  }): Promise<void> {
    try {
      const text = args.text.trim().slice(0, 2_000);
      if (!text) return;
      const vec = await this.embedder.embedQuery(text);
      if (!vec) return;
      const vecStr = `[${vec.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE "ideas" SET "embedding" = $1::vector WHERE "id" = $2`,
        vecStr,
        args.id,
      );
    } catch {
      // graceful
    }
  }
}
