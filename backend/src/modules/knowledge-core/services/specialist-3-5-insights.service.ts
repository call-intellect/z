import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type IdeaBlock,
  type IdeaBlockEvidence,
  type Insight,
  type InsightDynamic,
  type InsightKind,
  type InsightSeverity,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';

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
import { CurationService } from '../../curation/services/curation.service';
import {
  INSIGHT_CAUSE_CATEGORIES,
  INSIGHT_EXTRACT_JSON_SCHEMA,
  INSIGHT_EXTRACT_SCHEMA_NAME,
  INSIGHT_EXTRACT_SYSTEM_PROMPT,
  INSIGHT_EXTRACT_USER_TEMPLATE,
  type InsightCauseCategory,
} from '../prompts/insight-extract.prompt';
import {
  INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA,
  INSIGHT_LINK_TO_DECISIONS_SCHEMA_NAME,
  INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT,
  INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE,
} from '../prompts/insight-link-to-decisions.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';
import { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';
import { ACTIVE_LINK_FILTER } from './link-read-filter';
import { Specialist35ProbeService } from './specialist-3-5-probe.service';

/**
 * SBA β-4 — Specialist35Service.
 *
 * Логика специалиста 3.5 (Insights Radar): блок (signalType ∈ {pain, risk,
 * churn_risk, objection}) → KNN-кластеризация поверх существующих Insight →
 * (обновление существующего ИЛИ extract + triage нового) → linking с Decisions
 * → probe-events.
 *
 * Архитектура совпадает с β-3 (Decisions): KNN через pgvector embeddings,
 * LLM-арбитр для extraction и linking, CurationService.triage перед
 * канонизацией.
 *
 * Контракт §5 sub-TZ:
 *   1. consumer `core.specialist-routing` jobName='3-5-insights' (worker).
 *   2. Prisma-модель Insight (β-4).
 *   3. triage перед канонизацией — `insight` НЕ в critical-types default,
 *      но severity='critical' → confidence снижаем до 0.3 (force deep review).
 *   4. probe-events — Specialist35ProbeService (4 trigger'а).
 *   5. metrics — `core_specialist_*{type='insight'}` + `insights_dynamic_label_count`.
 */
@Injectable()
export class Specialist35Service {
  private readonly logger = new Logger(Specialist35Service.name);

  static readonly SPECIALIST_NAME = '3-5-insights';
  /** Top-K для cosine KNN кластеризации повторов. */
  private static readonly KNN_TOP_K = 10;
  /** Минимальная уверенность extraction, ниже которой пропускаем triage. */
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;
  /** Сколько Decision-кандидатов брать для linking-арбитра. */
  private static readonly LINK_CANDIDATES_LIMIT = 10;
  /**
   * Б59 [K12] — схема ответа арбитра `insight-link-to-decisions`. Отделяет
   * легитимный пустой массив (связей нет) от кривой формы (молча терялись
   * связи): неверная форма не пройдёт safeParse → логируем + метрика, не
   * выдаём за «связей нет». reasoning опционально (на парсинг id не влияет).
   */
  private static readonly LINK_RESPONSE_SCHEMA = z.object({
    linkedDecisionIds: z.array(z.string()),
    reasoning: z.string().optional(),
  });

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(EntityResolutionService)
    private readonly entities: EntityResolutionService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(Specialist35ProbeService)
    private readonly probes: Specialist35ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    // W4.1 — DataClassPolicyService для shadow-compare.
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   * Defensive try/catch — старые unit-тесты могут мокать cfg без `aiFeatures`.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  // ───────────────────── публичный метод (вызывается из воркера) ─────────────────────

  /**
   * Обработка одного IdeaBlock. См. §5 sub-TZ:
   *   1. load block + evidence.
   *   2. compute embedding query (statement = trustedAnswer + name).
   *   3. KNN top-K existing Insight (threshold INSIGHT_CLUSTER_THRESHOLD).
   *   4. если match — update existing; recalcMetrics.
   *   5. иначе — LLM extract → draft → resolve entities → linked-decisions LLM
   *      → triage → create Insight.
   *   6. probe-events.
   */
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

    // signalType фильтр (worker уже фильтрует по jobName, тут — на всякий случай;
    // sub-TZ упоминает problem/blocker/inefficiency — это НЕ существующие
    // SignalType (живут только в InsightKind), потому не падаем при их отсутствии).
    const supportedSignal = new Set([
      'pain',
      'risk',
      'churn_risk',
      'objection',
    ]);
    if (!supportedSignal.has(block.signalType)) return;

    try {
      // Б27 [K4] — детерминированный дедуп ПЕРЕД KNN.
      // KNN недетерминирован (промах при ретрае / отсутствии embedding / ниже
      // порога) → один и тот же block мог породить дубль Insight. Сначала
      // прямой pre-check по GIN-массиву sourceBlockIds: если уже есть активный
      // Insight, ссылающийся на этот block, — обогащаем его (как guard
      // ideas/decisions через `sourceBlockIds: { has: ... }`) и выходим.
      const dedupExisting = await this.prisma.insight.findFirst({
        where: {
          tenantId: block.tenantId,
          sourceBlockIds: { has: block.id },
          status: { notIn: ['archived'] },
        },
      });
      if (dedupExisting) {
        await this.updateExistingInsight({
          existing: dedupExisting,
          block,
        });
        return;
      }

      const queryText = this.buildQueryText(block);
      const matched = await this.findMatchingInsight({
        tenantId: block.tenantId,
        queryText,
      });

      if (matched) {
        await this.updateExistingInsight({
          existing: matched,
          block,
        });
        return;
      }

      // Новый Insight — extract + triage.
      const draft = await this.extractDraft(block);
      if (!draft) return;

      const affectedEntityIds = await this.resolveAffectedEntities({
        tenantId: block.tenantId,
        hints: draft.affectedEntityHints ?? [],
      });

      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      const severity = (draft.severity ?? 'medium') as InsightSeverity;
      const kind = draft.kind as InsightKind;

      // Initial dynamic — для нового всегда 'stable'.
      const dynamicLabel: InsightDynamic = 'stable';

      // SBA β-4 wave 2 (2026-05-23): валидируем causeCategory от LLM.
      // strict JSON-schema гарантирует enum, но если ответ пришёл от
      // fallback-tier'а без strict-mode — нормализуем.
      const causeCategory = Specialist35Service.normalizeCauseCategory(
        draft.causeCategory,
      );

      const insight = await this.createInsight({
        block,
        kind,
        statement: draft.statement,
        severity,
        affectedEntityIds,
        personSubjectIds,
        mitigationPlan: draft.mitigationSuggestion ?? null,
        confidence: draft.confidence,
        dynamicLabel,
        causeCategory,
      });

      // Embedding (best-effort).
      await this.tryWriteEmbedding({
        id: insight.id,
        text: queryText,
      });

      // Linked decisions (LLM-арбитр; best-effort).
      const linkedDecisionIds = await this.linkToDecisions({
        insight,
        tenantId: block.tenantId,
      });
      if (linkedDecisionIds.length > 0) {
        await this.prisma.insight.update({
          where: { id: insight.id },
          data: { relatedDecisionIds: { set: linkedDecisionIds } },
        });
        insight.relatedDecisionIds = [...linkedDecisionIds];
      }

      // Также: добавить Decision'ы из IdeaBlockLink.relationType='consequences_of'.
      const consequenceDecisionIds = await this.findConsequenceDecisions({
        tenantId: block.tenantId,
        blockIds: insight.sourceBlockIds,
      });
      if (consequenceDecisionIds.length > 0) {
        const merged = Array.from(
          new Set([...insight.relatedDecisionIds, ...consequenceDecisionIds]),
        );
        await this.prisma.insight.update({
          where: { id: insight.id },
          data: { relatedDecisionIds: { set: merged } },
        });
        insight.relatedDecisionIds = merged;
      }

      // Triage. Для severity='critical' снижаем confidence в triage до 0.3,
      // чтобы гарантировать deep review.
      const triageConfidence =
        severity === 'critical' ? 0.3 : draft.confidence;
      await this.triageProposed({
        tenantId: block.tenantId,
        resourceId: insight.id,
        confidence: triageConfidence,
        proposedPayload: {
          kind: insight.kind,
          statement: insight.statement,
          severity: insight.severity,
          // SBA β-4 wave 2: причина — в payload триажа, чтобы куратор
          // подтвердил / отредактировал классификацию LLM.
          causeCategory: insight.causeCategory,
          affectedEntityIds: insight.affectedEntityIds,
          relatedDecisionIds: insight.relatedDecisionIds,
          mitigationPlan: insight.mitigationPlan,
          personSubjectIds: insight.personSubjectIds,
          sourceBlockIds: insight.sourceBlockIds,
        },
        dataClass: block.dataClass,
      });

      // Probe: linked_decision_question (если LLM нашёл связки).
      if (linkedDecisionIds.length > 0) {
        await this.probes.emitLinkedDecisionQuestion({
          insight,
          candidateDecisionIds: linkedDecisionIds,
          reasoning: 'LLM insight-link-to-decisions',
        });
      }

      // Probe: escalation (на новый — только если severity='critical'/'high').
      await this.probes.checkAndEmitForInsight({
        insight,
        addedToMitigated: false,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.processBlock: ошибка записи — пробрасываю для повтора (BullMQ retry)',
      );
      throw err;
    }
  }

  /**
   * Пересчёт frequency / dynamic для конкретного Insight. Вызывается из
   * InsightClustererCron раз в N часов (на каждом active Insight).
   */
  async recalcMetrics(args: { insightId: string }): Promise<void> {
    const ins = await this.prisma.insight.findUnique({
      where: { id: args.insightId },
    });
    if (!ins) return;

    try {
      const windowDays = this.cfg.insights.frequencyWindowDays;
      const now = new Date();
      const window7d = new Date(now.getTime() - 7 * 24 * 3600_000);
      const window30d = new Date(
        now.getTime() - windowDays * 24 * 3600_000,
      );

      // 7d_count: блоки в sourceBlockIds, у которых createdAt >= 7d ago.
      // 30d_count: блоки в sourceBlockIds, у которых createdAt >= window.
      const blockIds = ins.sourceBlockIds;
      if (blockIds.length === 0) {
        return;
      }
      const [count7d, count30d, totalOrg30d] = await Promise.all([
        this.prisma.ideaBlock.count({
          where: {
            id: { in: blockIds },
            tenantId: ins.tenantId,
            createdAt: { gte: window7d },
          },
        }),
        this.prisma.ideaBlock.count({
          where: {
            id: { in: blockIds },
            tenantId: ins.tenantId,
            createdAt: { gte: window30d },
          },
        }),
        this.prisma.ideaBlock.count({
          where: {
            tenantId: ins.tenantId,
            createdAt: { gte: window30d },
          },
        }),
      ]);

      const avgWeekly30d = count30d / (windowDays / 7);
      const ratio = count7d / Math.max(avgWeekly30d, 1);
      const spikeRatio = this.cfg.insights.spikeRatio;

      let dynamicLabel: InsightDynamic;
      if (ratio > spikeRatio) dynamicLabel = 'spike';
      else if (ratio > 1.3) dynamicLabel = 'growing';
      else if (ratio < 0.5) dynamicLabel = 'declining';
      else dynamicLabel = 'stable';

      const frequencyScore =
        totalOrg30d > 0 ? Math.min(1, count30d / totalOrg30d) : 0;

      await this.prisma.insight.update({
        where: { id: ins.id },
        data: {
          frequencyScore: new Prisma.Decimal(
            this.clampDecimal(frequencyScore, 0, 999),
          ),
          dynamicScore: new Prisma.Decimal(
            this.clampDecimal(ratio, 0, 999),
          ),
          dynamicLabel,
        },
      });

      // Probe escalation_suggested при spike (cron-trigger).
      if (dynamicLabel === 'spike' && ins.dynamicLabel !== 'spike') {
        const fresh = { ...ins, dynamicLabel, frequencyScore: ins.frequencyScore, dynamicScore: ins.dynamicScore };
        await this.probes.emitEscalationSuggested(fresh as Insight);
      }
    } catch (err) {
      this.logger.warn(
        {
          insightId: ins.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.recalcMetrics: упал — пропускаю',
      );
    }
  }

  /**
   * TZ-1 Фаза 3.A (daily-value-engine) — мост «хронический блокер → Insight».
   *
   * Вызывается из `BlockerSynthesisService`, когда кластер блокеров стал
   * `recurring` и держится ≥ N дней. Переиспользует существующую модель Insight
   * (kind='internal', статус active) вместо плодёжа отдельной сущности.
   *
   * Идемпотентность: если `existingInsightId` передан и Insight ещё активен —
   * просто дополняем `sourceBlockIds` и `lastObservedAt` (не создаём дубль).
   * Иначе создаём новый Insight. Возвращает id Insight'а (для `linkedInsightId`)
   * или null при сбое (best-effort — не валим cron).
   */
  async bridgeRecurringBlocker(args: {
    tenantId: string;
    statement: string;
    sourceBlockIds: string[];
    /** Уже связанный Insight (из BlockerSynthesis.linkedInsightId), если есть. */
    existingInsightId?: string | null;
    /** severity по бизнес-удару кластера. */
    severity?: InsightSeverity;
  }): Promise<string | null> {
    try {
      const severity: InsightSeverity = args.severity ?? 'medium';
      const blockIds = Array.from(
        new Set(args.sourceBlockIds.filter((s) => typeof s === 'string' && s)),
      ).slice(0, 50);

      // 1. Если уже привязан активный Insight — дополняем, не дублируем.
      if (args.existingInsightId) {
        const existing = await this.prisma.insight.findUnique({
          where: { id: args.existingInsightId },
          select: { id: true, tenantId: true, status: true, sourceBlockIds: true },
        });
        if (
          existing &&
          existing.tenantId === args.tenantId &&
          existing.status !== 'archived'
        ) {
          const merged = Array.from(
            new Set([...existing.sourceBlockIds, ...blockIds]),
          ).slice(0, 100);
          await this.prisma.insight.update({
            where: { id: existing.id },
            data: {
              sourceBlockIds: { set: merged },
              lastObservedAt: new Date(),
              status: existing.status === 'mitigated' ? 'active' : existing.status,
            },
          });
          return existing.id;
        }
      }

      // 2. Создаём новый Insight (статус active, kind='blocker').
      const created = await this.prisma.insight.create({
        data: {
          tenantId: args.tenantId,
          kind: 'blocker',
          statement: args.statement.slice(0, 2_000),
          severity,
          sourceBlockIds: blockIds,
          causeCategory: 'process_gap',
          confidence: new Prisma.Decimal(0.6),
          dataClass: 'internal',
          firstObservedAt: new Date(),
          lastObservedAt: new Date(),
          dynamicLabel: 'stable',
          frequencyScore: new Prisma.Decimal(0),
          dynamicScore: new Prisma.Decimal(0),
          status: 'active',
        },
        select: { id: true },
      });
      return created.id;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.bridgeRecurringBlocker: упал — пропускаю мост',
      );
      return null;
    }
  }

  // ─────────────────────────── KNN-кластеризация ───────────────────────────

  private async findMatchingInsight(args: {
    tenantId: string;
    queryText: string;
  }): Promise<Insight | null> {
    const text = args.queryText.trim().slice(0, 2_000);
    if (!text) return null;

    let embedding: number[] | null;
    try {
      embedding = await this.embedder.embedQuery(text);
    } catch {
      embedding = null;
    }
    if (!embedding) return null;

    const threshold = this.cfg.insights.clusterThreshold;

    try {
      const vec = `[${embedding.join(',')}]`;
      // cosine distance = 1 - similarity → similarity = 1 - dist.
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; distance: number }>
      >(
        `SELECT "id", ("embedding" <=> $2::vector) AS distance
         FROM "insights"
         WHERE "tenantId" = $1
           AND "embedding" IS NOT NULL
           AND "status" IN ('active','mitigating','mitigated')
         ORDER BY "embedding" <=> $2::vector
         LIMIT ${Specialist35Service.KNN_TOP_K}`,
        args.tenantId,
        vec,
      );
      if (rows.length === 0) return null;
      const best = rows[0];
      if (!best) return null;
      const sim = 1 - Number(best.distance);
      if (sim < threshold) return null;
      const full = await this.prisma.insight.findFirst({
        where: { id: best.id, tenantId: args.tenantId },
      });
      return full;
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.findMatchingInsight: pgvector KNN упал — пропускаю',
      );
      return null;
    }
  }

  // ─────────────────────────── update existing ───────────────────────────

  private async updateExistingInsight(args: {
    existing: Insight;
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] };
  }): Promise<void> {
    const wasMitigated = args.existing.status === 'mitigated';
    const newSourceBlockIds = Array.from(
      new Set([...args.existing.sourceBlockIds, args.block.id]),
    );
    const subjects = await this.resolvePersonSubjects(args.block.id);
    const mergedSubjects = Array.from(
      new Set([...args.existing.personSubjectIds, ...subjects]),
    );

    const updated = await this.prisma.insight.update({
      where: { id: args.existing.id },
      data: {
        sourceBlockIds: { set: newSourceBlockIds },
        personSubjectIds: { set: mergedSubjects },
        lastObservedAt: new Date(),
        lastConfirmedAt: new Date(),
      },
    });

    // Сразу пересчёт метрик после добавления нового блока.
    await this.recalcMetrics({ insightId: updated.id });
    const recalculated = await this.prisma.insight.findUnique({
      where: { id: updated.id },
    });
    if (!recalculated) return;

    await this.probes.checkAndEmitForInsight({
      insight: recalculated,
      addedToMitigated: wasMitigated,
    });
  }

  // ─────────────────────────── LLM extract ───────────────────────────

  private async extractDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
  ): Promise<InsightDraft | null> {
    const start = Date.now();
    const quotes = block.evidence
      .slice(0, 6)
      .map((e) => e.quote)
      .filter((q) => q && q.length > 0);

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (контент блока) в маркеры.
    const guardOnExtract = this.isPromptInjectionGuardEnabled();
    const rawUserExtract = INSIGHT_EXTRACT_USER_TEMPLATE({
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
        taskType: 'insight-extract',
        systemPrompt: guardOnExtract
          ? withInjectionGuard(INSIGHT_EXTRACT_SYSTEM_PROMPT)
          : INSIGHT_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOnExtract ? wrapUserData(rawUserExtract) : rawUserExtract,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: INSIGHT_EXTRACT_SCHEMA_NAME,
          schema: INSIGHT_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: block.id },
        dataClass: block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.extractDraft: LLM упал — skip',
      );
      return null;
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'insight',
        seconds: (Date.now() - start) / 1000,
      });
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'insight',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: InsightDraft | null;
    try {
      parsed = JSON.parse(result.text) as InsightDraft;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'json_parse',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
          textSample: result.text.slice(0, 300),
        },
        'specialist-3-5.extractDraft: JSON.parse упал — skip',
      );
      return null;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.statement ||
      !parsed.kind
    ) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'schema_validation',
      });
      return null;
    }
    if ((parsed.confidence ?? 0) < Specialist35Service.MIN_EXTRACT_CONFIDENCE) {
      this.logger.debug(
        { blockId: block.id, confidence: parsed.confidence },
        'specialist-3-5.extractDraft: confidence слишком низкий — skip',
      );
      return null;
    }
    return parsed;
  }

  // ─────────────────────────── linking with Decisions ───────────────────────────

  private async linkToDecisions(args: {
    insight: Insight;
    tenantId: string;
  }): Promise<string[]> {
    // 1) KNN на Decision'ах того же tenant (cosine по embedding).
    let candidates: Array<{
      id: string;
      statement: string;
      decidedAt: string | null;
      status: string;
    }> = [];
    try {
      let embedding: number[] | null = null;
      try {
        embedding = await this.embedder.embedQuery(
          args.insight.statement.slice(0, 2_000),
        );
      } catch {
        embedding = null;
      }
      if (embedding) {
        const vec = `[${embedding.join(',')}]`;
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{
            id: string;
            statement: string | null;
            text: string | null;
            decidedAt: Date | null;
            status: string;
          }>
        >(
          `SELECT "id", "statement", "text", "decidedAt", "status"
           FROM "decisions"
           WHERE "tenantId" = $1
             AND "embedding" IS NOT NULL
             AND "status" NOT IN ('rejected','cancelled','superseded')
           ORDER BY "embedding" <=> $2::vector
           LIMIT ${Specialist35Service.LINK_CANDIDATES_LIMIT}`,
          args.tenantId,
          vec,
        );
        candidates = rows.map((r) => ({
          id: r.id,
          statement: r.statement ?? r.text ?? '',
          decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
          status: r.status,
        }));
      }
    } catch {
      candidates = [];
    }

    if (candidates.length === 0) return [];

    // 2) LLM арбитр.
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (insight + кандидаты) в маркеры.
    const guardOnLink = this.isPromptInjectionGuardEnabled();
    const rawUserLink = INSIGHT_LINK_TO_DECISIONS_USER_TEMPLATE({
      insightKind: args.insight.kind,
      insightStatement: args.insight.statement,
      candidates,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'insight-link-to-decisions',
        systemPrompt: guardOnLink
          ? withInjectionGuard(INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT)
          : INSIGHT_LINK_TO_DECISIONS_SYSTEM_PROMPT,
        userMessage: guardOnLink ? wrapUserData(rawUserLink) : rawUserLink,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: INSIGHT_LINK_TO_DECISIONS_SCHEMA_NAME,
          schema: INSIGHT_LINK_TO_DECISIONS_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'insight', id: args.insight.id },
        dataClass: args.insight.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'arbiter_skip',
      });
      this.logger.warn(
        {
          insightId: args.insight.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.linkToDecisions: LLM упал — пропускаю linking',
      );
      return [];
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'insight',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    // Б59 [K12] — осознанный парсинг ответа арбитра.
    // Раньше: голый JSON.parse без проверки формы → кривой ответ (объект без
    // массива, число, строка) тихо давал пустой список, и связи insight→decision
    // молча терялись. Теперь: Zod-схема ответа. Пустой массив [] — нормальный
    // и частый исход (связи нет), он проходит валидацию. А вот сломанный JSON
    // или НЕВЕРНАЯ форма (linkedDecisionIds не массив) — это аномалия: логируем
    // warn + метрика invalid, не выдаём её за «связей нет».
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(result.text);
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'link_parse_invalid',
      });
      this.logger.warn(
        {
          insightId: args.insight.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.linkToDecisions: ответ арбитра — не JSON, пропускаю linking',
      );
      return [];
    }
    const validated =
      Specialist35Service.LINK_RESPONSE_SCHEMA.safeParse(parsedJson);
    if (!validated.success) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'insight',
        reason: 'link_parse_invalid',
      });
      this.logger.warn(
        {
          insightId: args.insight.id,
          issues: validated.error.issues.map((i) => i.message).slice(0, 5),
        },
        'specialist-3-5.linkToDecisions: ответ арбитра не прошёл схему (кривая форма), пропускаю linking',
      );
      return [];
    }
    const candidateIds = new Set(candidates.map((c) => c.id));
    const linked = validated.data.linkedDecisionIds.filter((id) =>
      candidateIds.has(id),
    );
    return linked;
  }

  /**
   * Доп. источник linking — существующие IdeaBlockLink.relationType='consequences_of'
   * для блоков-источников Insight. Если есть link на блок Decision (через
   * Decision.sourceBlockIds), включаем тот Decision в relatedDecisionIds.
   */
  private async findConsequenceDecisions(args: {
    tenantId: string;
    blockIds: readonly string[];
  }): Promise<string[]> {
    if (args.blockIds.length === 0) return [];
    try {
      const links = await this.prisma.ideaBlockLink.findMany({
        where: {
          tenantId: args.tenantId,
          ...ACTIVE_LINK_FILTER,
          relationType: 'consequences_of',
          fromBlockId: { in: [...args.blockIds] },
        },
        select: { toBlockId: true },
        take: 100,
      });
      if (links.length === 0) return [];
      const targetBlockIds = Array.from(
        new Set(links.map((l) => l.toBlockId)),
      );
      const decisions = await this.prisma.decision.findMany({
        where: {
          tenantId: args.tenantId,
          sourceBlockIds: { hasSome: targetBlockIds },
        },
        select: { id: true },
        take: 50,
      });
      return decisions.map((d) => d.id);
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.findConsequenceDecisions: упал — пропускаю',
      );
      return [];
    }
  }

  // ─────────────────────────── persist helpers ───────────────────────────

  private async createInsight(args: {
    block: IdeaBlock;
    kind: InsightKind;
    statement: string;
    severity: InsightSeverity;
    affectedEntityIds: string[];
    personSubjectIds: string[];
    mitigationPlan: string | null;
    confidence: number;
    dynamicLabel: InsightDynamic;
    /** SBA β-4 wave 2 — категория первопричины (LLM-классифицировано). */
    causeCategory: InsightCauseCategory;
  }): Promise<Insight> {
    // W4.1/W4.2 — derive DataClass.
    // legacy = elevateDataClass(block, 'internal') (floor=internal вручную).
    // proposed — DataClassPolicyService.derive({ kind: 'insight' }).
    // На 'enforce' — пишем derive() + audit; на shadow/off — legacy.
    const legacyDataClass = this.elevateDataClass(
      args.block.dataClass,
      'internal',
    );
    const enforcement = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const proposed = this.dataClassPolicy?.derive({
      sources: [
        {
          dataClass: args.block.dataClass,
          sourceId: args.block.id,
          sourceKind: 'idea_block',
        },
      ],
      context: { kind: 'insight' },
    });
    if (this.dataClassPolicy && proposed) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: legacyDataClass,
        proposedResult: proposed.dataClass,
        kind: 'insight',
        sourceIds: [args.block.id],
      });
    }
    const finalDc =
      enforcement === 'enforce' && proposed
        ? proposed.dataClass
        : legacyDataClass;
    const audit =
      enforcement === 'enforce' && proposed
        ? (proposed.audit as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    return this.prisma.insight.create({
      data: {
        tenantId: args.block.tenantId,
        kind: args.kind,
        statement: args.statement,
        severity: args.severity,
        affectedEntityIds: args.affectedEntityIds,
        personSubjectIds: args.personSubjectIds,
        sourceBlockIds: [args.block.id],
        mitigationPlan: args.mitigationPlan,
        causeCategory: args.causeCategory,
        confidence: new Prisma.Decimal(
          Math.max(0, Math.min(1, args.confidence)),
        ),
        // Insight чаще про процесс — default 'internal' (см. §13 sub-ТЗ).
        // W4.2: в enforce-режиме источником истины становится derive().
        dataClass: finalDc,
        dataClassAudit: audit,
        firstObservedAt: new Date(),
        lastObservedAt: new Date(),
        dynamicLabel: args.dynamicLabel,
        frequencyScore: new Prisma.Decimal(0),
        dynamicScore: new Prisma.Decimal(0),
        status: 'active',
      },
    });
  }

  /**
   * SBA β-4 wave 2 — нормализация ответа LLM по causeCategory.
   * Допускает только значения из INSIGHT_CAUSE_CATEGORIES; при отсутствии или
   * неизвестном значении возвращает 'unknown' (см. §3 sub-TZ — куратор уточнит).
   */
  static normalizeCauseCategory(
    raw: string | null | undefined,
  ): InsightCauseCategory {
    if (!raw) return 'unknown';
    const v = raw.trim().toLowerCase();
    return (INSIGHT_CAUSE_CATEGORIES as readonly string[]).includes(v)
      ? (v as InsightCauseCategory)
      : 'unknown';
  }

  /**
   * @deprecated W4.2 (2026-05-25) — используй `DataClassPolicyService.derive()`.
   * Оставлено как legacy path при `enforcement` ∈ {'off','shadow'} — для
   * сохранения исторического поведения и сравнения через compareWithLegacy.
   */
  private elevateDataClass(
    blockClass: DataClass,
    defaultClass: DataClass,
  ): DataClass {
    const order: DataClass[] = ['public', 'internal', 'sensitive', 'private'];
    const blockRank = order.indexOf(blockClass);
    const defaultRank = order.indexOf(defaultClass);
    return blockRank > defaultRank ? blockClass : defaultClass;
  }

  // ─────────────────────────── resolvers ───────────────────────────

  private async resolveAffectedEntities(args: {
    tenantId: string;
    hints: ReadonlyArray<{ name: string; type: string }>;
  }): Promise<string[]> {
    const ids = new Set<string>();
    const SUPPORTED_TYPES = new Set([
      'customer',
      'project',
      'product',
      'vendor',
    ]);

    for (const hint of args.hints) {
      const name = hint.name?.trim();
      const type = hint.type;
      if (!name || !type) continue;
      // 'process' пока не Entity — скипаем для β-4 (см. β-3).
      if (!SUPPORTED_TYPES.has(type)) continue;
      try {
        const { entity } = await this.entities.findOrCreateEntity({
          tenantId: args.tenantId,
          type: type as 'customer' | 'project' | 'product' | 'vendor',
          name,
        });
        ids.add(entity.id);
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            hint: { name, type },
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-5.resolveAffectedEntities: findOrCreate упал — skip',
        );
      }
    }
    return [...ids];
  }

  private async resolvePersonSubjects(blockId: string): Promise<string[]> {
    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId,
        entity: { type: 'person' },
      },
      select: { entityId: true },
    });
    if (mentions.length === 0) return [];
    const persons = await this.prisma.person.findMany({
      where: {
        entityId: { in: mentions.map((m) => m.entityId) },
        deletedAt: null,
      },
      select: { id: true },
    });
    return [...new Set(persons.map((p) => p.id))];
  }

  // ─────────────────────────── triage ───────────────────────────

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
        resourceType: 'insight',
        resourceId: args.resourceId,
        confidence: Math.min(1, Math.max(0, args.confidence)),
        proposedPayload: args.proposedPayload,
        conflictSignal: 'none',
        createdByUserId: null,
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.logger.error(
        {
          tenantId: args.tenantId,
          resourceId: args.resourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.triage: упал — карточка осталась без CurationItem',
      );
    }
  }

  // ─────────────────────────── embedding ───────────────────────────

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
        `UPDATE "insights" SET "embedding" = $1::vector WHERE "id" = $2`,
        vecStr,
        args.id,
      );
    } catch (err) {
      this.logger.debug(
        {
          id: args.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-5.tryWriteEmbedding: пропускаю (best-effort)',
      );
    }
  }

  // ─────────────────────────── utils ───────────────────────────

  private buildQueryText(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
  ): string {
    const parts = [block.name, block.trustedAnswer]
      .filter((s) => s && s.length > 0)
      .join('. ');
    return parts.slice(0, 2_000);
  }

  private clampDecimal(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}

// ─────────────────────────── shared types ───────────────────────────

interface InsightDraft {
  kind: 'problem' | 'risk' | 'blocker' | 'inefficiency';
  statement: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  affectedEntityHints?: Array<{ name: string; type: string }>;
  mitigationSuggestion?: string | null;
  /** SBA β-4 wave 2 — категория первопричины (LLM-классифицировано). */
  causeCategory?: string | null;
  confidence: number;
}
