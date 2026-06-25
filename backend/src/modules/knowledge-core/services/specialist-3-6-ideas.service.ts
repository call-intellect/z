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
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { CurationService } from '../../curation/services/curation.service';
import { SystemLogPipeline } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
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
  isIdea?: boolean;
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
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(LogService) private readonly logs: LogService,
    // W4.1 — DataClassPolicyService для shadow-compare.
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    @Optional()
    @Inject(AdminSettingsService)
    private readonly settings?: AdminSettingsService,
  ) {}

  private async getMinExtractConfidence(): Promise<number> {
    const v = await this.settings
      ?.get<number>('knowledge.ideasExtractMinConfidence')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : Specialist36Service.MIN_EXTRACT_CONFIDENCE;
  }

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
    if (!allowed.has(block.signalType)) {
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-6-ideas',
        action: 'skipped',
        message: `Idea пропущена: signalType '${block.signalType}' не идея`,
        orgId: block.tenantId,
        details: {
          type: 'idea',
          reason: 'signal_out_of_scope',
          blockId: block.id,
        },
      });
      return;
    }

    // Ф1 idea direct-path dedup (2026-06-08): если Idea уже материализована из
    // ЭТОГО блока (block-ingest direct-path ИЛИ прошлый прогон специалиста при
    // ретрае джоба) — НЕ создаём дубль. Обогащаем существующую (supporters /
    // sourceBlockIds / weight), как KNN-merge, и выходим. Детерминированно по
    // sourceBlockId — не зависит от наличия embedding'а у direct-path идеи.
    const alreadyMaterialized = await this.prisma.idea.findFirst({
      where: {
        tenantId: block.tenantId,
        sourceBlockIds: { has: block.id },
        status: { notIn: ['rejected', 'archived'] },
      },
    });
    if (alreadyMaterialized) {
      await this.upgradeIdeaQuality({ existing: alreadyMaterialized, block }).catch((err) =>
        this.logger.warn(
          {
            ideaId: alreadyMaterialized.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-6: upgradeIdeaQuality упал — продолжаем обогащение',
        ),
      );
      try {
        await this.updateExistingIdea({ existing: alreadyMaterialized, block });
      } catch (err) {
        this.logger.warn(
          {
            blockId: block.id,
            ideaId: alreadyMaterialized.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-6: обогащение уже-материализованной идеи упало — пропуск',
        );
      }
      // Б37 [K4] — выравнивание инварианта direct-path ↔ Specialist 3.6.
      // direct-path block-ingest материализует Idea БЕЗ triage/curation (нет
      // CurationService в воркере). Здесь — единственная точка, где у обоих путей
      // совпадает контракт видимости: идемпотентно прогоняем тот же triageProposed,
      // если у этой Idea ещё нет CurationItem (без дубля). Так direct-path-идея
      // получает ту же curation-видимость, что и созданная Specialist 3.6.
      await this.ensureTriaged(alreadyMaterialized);
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-6-ideas',
        action: 'merged',
        message: `Idea уже материализована из блока ${block.id} — обогащена ${alreadyMaterialized.id}`,
        orgId: block.tenantId,
        details: {
          type: 'idea',
          intoId: alreadyMaterialized.id,
          blockId: block.id,
          reason: 'source_block_dedup',
        },
      });
      return;
    }

    try {
      const queryText = this.buildQueryText(block);
      const matched = await this.findMatchingIdea({
        tenantId: block.tenantId,
        queryText,
      });
      if (matched) {
        await this.updateExistingIdea({ existing: matched, block });
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-6-ideas',
          action: 'merged',
          message: `Idea слита в существующую ${matched.id}`,
          orgId: block.tenantId,
          details: { type: 'idea', intoId: matched.id, blockId: block.id },
        });
        return;
      }

      const draft = await this.extractDraft(block);
      if (!draft) {
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-6-ideas',
          action: 'skipped',
          message: 'Idea не извлечена (нет черновика / низкий confidence)',
          orgId: block.tenantId,
          details: { type: 'idea', reason: 'no_draft', blockId: block.id },
        });
        return;
      }

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

      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-6-ideas',
        action: 'created',
        message: `создана Idea ${idea.id}`,
        orgId: block.tenantId,
        details: { type: 'idea', entityId: idea.id, blockId: block.id },
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

      // Б9 [K10] — enqueueIdeaClusterer убран: очередь core.idea-clusterer
      // удалена (у неё не было consumer'а). Кластеризация Idea → IdeaCluster
      // идёт асинхронно по расписанию в IdeaClustererCron (@Cron).
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
        'specialist-3-6.processBlock: ошибка записи — пробрасываю для повтора (BullMQ retry)',
      );
      throw err;
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

    // G6 condition-UPDATE (эталон fact-supersede.service.ts:456-471): меняем
    // статус ТОЛЬКО если он всё ещё равен прочитанному (oldStatus). Защита от
    // гонки авто-продвижения (IdeaStatusAutoAdvanceService) ↔ ручного изменения
    // человеком: между findFirst и update человек мог сменить статус — тогда
    // count===0, авто-переход устарел → no-op (не перетираем ручное решение,
    // не эмитим повторный idea.status_changed).
    const res = await this.prisma.idea.updateMany({
      where: { id: existing.id, status: oldStatus },
      data: {
        status: args.newStatus,
        statusChangedAt: new Date(),
        statusChangedByUserId: args.changedByUserId,
        statusReason: args.reason,
      },
    });
    if (res.count === 0) {
      // Статус уже изменён другим путём (человеком/параллельно) — возвращаем
      // актуальное состояние без события.
      const current = await this.prisma.idea.findFirst({
        where: { id: existing.id, tenantId: args.tenantId },
      });
      return current ?? existing;
    }
    const updated = await this.prisma.idea.findFirst({
      where: { id: existing.id, tenantId: args.tenantId },
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

    return updated ?? { ...existing, status: args.newStatus };
  }

  async markRealizedByDecision(args: {
    tenantId: string;
    ideaId: string;
    decisionId: string;
    reason?: string | null;
  }): Promise<{ linked: boolean; statusAdvanced: boolean }> {
    const existing = await this.prisma.idea.findFirst({
      where: { id: args.ideaId, tenantId: args.tenantId },
      select: { id: true, status: true, realizedAsDecisionId: true },
    });
    if (!existing) return { linked: false, statusAdvanced: false };
    if (existing.realizedAsDecisionId) {
      return { linked: false, statusAdvanced: false };
    }
    const shouldAdvance =
      existing.status === 'captured' || existing.status === 'in_discussion';
    const res = await this.prisma.idea.updateMany({
      where: { id: existing.id, tenantId: args.tenantId, realizedAsDecisionId: null },
      data: {
        realizedAsDecisionId: args.decisionId,
        ...(shouldAdvance
          ? {
              status: 'accepted',
              statusChangedAt: new Date(),
              statusReason: args.reason ?? 'realized_by_decision',
            }
          : {}),
      },
    });
    return {
      linked: res.count > 0,
      statusAdvanced: res.count > 0 && shouldAdvance,
    };
  }

  async reconcileIdeaForDecision(args: {
    tenantId: string;
    decisionId: string;
    decisionText: string;
  }): Promise<{ matched: boolean; ideaId: string | null }> {
    const text = args.decisionText.trim().slice(0, 2_000);
    if (!text) return { matched: false, ideaId: null };
    let embedding: number[] | null;
    try {
      embedding = await this.embedder.embedQuery(text);
    } catch {
      return { matched: false, ideaId: null };
    }
    if (!embedding) return { matched: false, ideaId: null };
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
           AND "realizedAsDecisionId" IS NULL
           AND "status" IN ('captured','in_discussion')
         ORDER BY "embedding" <=> $2::vector
         LIMIT ${Specialist36Service.KNN_TOP_K}`,
        args.tenantId,
        vec,
      );
      const best = rows[0];
      if (!best) return { matched: false, ideaId: null };
      const sim = 1 - Number(best.distance);
      if (sim < threshold) return { matched: false, ideaId: null };
      const res = await this.markRealizedByDecision({
        tenantId: args.tenantId,
        ideaId: best.id,
        decisionId: args.decisionId,
        reason: 'reconciled_with_decision',
      });
      return { matched: res.linked, ideaId: res.linked ? best.id : null };
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6.reconcileIdeaForDecision: KNN/link упал — пропускаю',
      );
      return { matched: false, ideaId: null };
    }
  }

  // ─────────────────────────── KNN / update ─────────────────────────────

  private async findMatchingIdea(args: {
    tenantId: string;
    queryText: string;
  }): Promise<Idea | null> {
    const text = args.queryText.trim().slice(0, 2_000);
    if (!text) return null;
    let embedding: number[] | null;
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

  private async upgradeIdeaQuality(args: {
    existing: Idea;
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] };
  }): Promise<void> {
    if (args.existing.createdByUserId !== null) return;
    if (args.existing.rationale !== null) return;
    const draft = await this.extractDraft(args.block);
    if (!draft || draft.isIdea === false) return;
    await this.prisma.idea.update({
      where: { id: args.existing.id },
      data: {
        statement: draft.statement,
        rationale: draft.rationale ?? null,
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
    // C3 anti-плодёж: явный булев гейт. Срабатывает ТОЛЬКО на явный false —
    // модель не обязана фабриковать карточку, если идеи в блоке нет.
    if (parsed.isIdea === false) {
      this.logger.debug(
        { blockId: block.id },
        'specialist-3-6.extractDraft: isIdea=false — это не идея, skip',
      );
      return null;
    }
    const minConfidence = await this.getMinExtractConfidence();
    if (parsed.confidence < minConfidence) {
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

  /**
   * Б37 [K4] — идемпотентно гарантирует, что у Idea (материализованной
   * direct-path'ом block-ingest) есть CurationItem, как если бы её создал
   * Specialist 3.6 «с нуля». Если CurationItem по (resourceType='idea',
   * resourceId) уже есть — НЕ создаём дубль. confidence берём из самой Idea
   * (direct-path сохраняет его в `Idea.confidence`).
   */
  private async ensureTriaged(idea: Idea): Promise<void> {
    try {
      const existingItem = await this.prisma.curationItem.findFirst({
        where: { resourceType: 'idea', resourceId: idea.id },
        select: { id: true },
      });
      if (existingItem) return;
      const confidence = Math.min(1, Math.max(0, Number(idea.confidence)));
      await this.triageProposed({
        tenantId: idea.tenantId,
        resourceId: idea.id,
        confidence,
        proposedPayload: {
          kind: idea.kind,
          statement: idea.statement,
          rationale: idea.rationale,
          supporters: idea.supporters,
          weight: Number(idea.weight),
          sourceBlockIds: idea.sourceBlockIds,
        },
        dataClass: idea.dataClass,
      });
    } catch (err) {
      this.logger.warn(
        {
          ideaId: idea.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6.ensureTriaged: не удалось гарантировать CurationItem — пропуск',
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
