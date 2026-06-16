import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type Decision,
  type DecisionStatus,
  type IdeaBlock,
  type IdeaBlockEvidence,
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
  type DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import { SystemLogPipeline } from '../../logging/log-pipeline';
import { LogService } from '../../logging/log.service';
import {
  DECISION_EXTRACT_JSON_SCHEMA,
  DECISION_EXTRACT_SCHEMA_NAME,
  DECISION_EXTRACT_SYSTEM_PROMPT,
  DECISION_EXTRACT_USER_TEMPLATE,
} from '../prompts/decision-extract.prompt';
import {
  DECISION_SUPERSEDE_DETECT_JSON_SCHEMA,
  DECISION_SUPERSEDE_DETECT_SCHEMA_NAME,
  DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT,
  DECISION_SUPERSEDE_DETECT_USER_TEMPLATE,
} from '../prompts/decision-supersede-detect.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';
import { KnowledgeEmbeddingService } from './embedding.service';
import { EntityResolutionService } from './entity-resolution.service';
import { Specialist33ProbeService } from './specialist-3-3-probe.service';

/**
 * SBA β-3 — Specialist33Service.
 *
 * Логика специалиста 3.3: блок (signalType ∈ {decision, rationale,
 * decision_basis}) → черновик Decision → KNN+LLM-арбитр (new/merge/supersedes)
 * → triage (deep review всегда: decision в CURATION_CRITICAL_TYPES_DEFAULT)
 * → probe-events.
 *
 * Контракт §5 sub-TZ:
 *   1. consumer `core.specialist-routing` jobName='3-3-decisions' (worker).
 *   2. Prisma-модель Decision (in-place extension Фазы 0a, см. §4 sub-TZ).
 *   3. triage перед канонизацией — всегда deep review (critical-type).
 *   4. probe-events — Specialist33ProbeService (5 trigger'ов).
 *   5. conflict-events — ConflictService.report с suggested resolution
 *      'evolving' при verdict='supersedes'.
 *   6. chat-v2 support — Specialist33CardHandler (через CardSpecialistRegistry).
 *   7. metrics — `core_specialist_*{type='decision'}` + специфичные
 *      `core_specialist_conflict_evolving_total` и
 *      `decision_supersede_chain_length`.
 */
@Injectable()
export class Specialist33Service {
  private readonly logger = new Logger(Specialist33Service.name);

  static readonly SPECIALIST_NAME = '3-3-decisions';
  /** Top-K для cosine KNN арбитра дедупа / supersede-detect. */
  private static readonly KNN_TOP_K = 5;
  /** Минимальная уверенность extraction, ниже которой пропускаем triage. */
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;
  /** Окно ±2 минуты для контекста rationale-extraction. */
  private static readonly CONTEXT_WINDOW_MS = 2 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(EntityResolutionService)
    private readonly entities: EntityResolutionService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(Specialist33ProbeService)
    private readonly probes: Specialist33ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LogService) private readonly logs: LogService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    // W4.1 — DataClassPolicyService для shadow-compare.
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    // Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate для supersede-detect.
    // Optional, чтобы старые тесты без модуля DI продолжали работать; на проде
    // подключается через @Global AiModule.
    @Optional()
    @Inject(MultiAgentDebateService)
    private readonly debate?: MultiAgentDebateService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  // ───────────────────── публичный метод (вызывается из воркера) ─────────────────────

  /**
   * Обработка одного IdeaBlock. См. §5 sub-TZ — последовательность:
   *   1. load block + evidence + context (±2 мин в той же встрече).
   *   2. LLM extract → draft.
   *   3. resolve decidedByPersonIds, affectsEntityIds.
   *   4. KNN top-K + LLM supersede-detect → verdict.
   *   5. apply: new / merge / supersedes.
   *   6. embedding (best-effort).
   *   7. triage (deep review всегда).
   *   8. probe-events.
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

    const contextQuotes = await this.loadContextQuotes(block);
    const draft = await this.extractDraft(block, contextQuotes);
    if (!draft) {
      this.logs.write({
        level: 'INFO',
        pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
        module: 'specialist-3-3-decisions',
        action: 'skipped',
        message: 'Decision не извлечён (нет черновика / низкий confidence)',
        orgId: block.tenantId,
        details: { type: 'decision', reason: 'no_draft', blockId: block.id },
      });
      return;
    }

    try {
      // Резолв decidedByPersonIds (через name-hints + linkPersonEntity).
      const decidedByPersonIds = await this.resolveDecidedByPersons({
        tenantId: block.tenantId,
        hints: draft.decidedByPersonHints ?? [],
        blockId: block.id,
      });

      // Резолв affectsEntityIds (через EntityResolutionService.findOrCreate).
      const affectsEntityIds = await this.resolveAffectsEntities({
        tenantId: block.tenantId,
        hints: draft.affectsEntityHints ?? [],
      });

      const personSubjectIds = await this.resolvePersonSubjects(block.id);
      const sourceBlockIds = [block.id];

      // Б3/Б48 source-block dedup (эталон specialist-3-6-ideas.service.ts:129-169):
      // если Decision уже материализован из ЭТОГО блока (block-ingest direct-path
      // создал «тонкий» Decision с sourceIdeaBlockId=blockId ИЛИ прошлый прогон
      // специалиста при re-dispatch) — НЕ создаём дубль. Без этого guard'а
      // createNewDecision пишет sourceIdeaBlockId=block.id → P2002 на @unique →
      // внешний catch инкрементит метрику и return без re-throw → богатое решение
      // теряется. notIn по статусам НЕ ставим намеренно: @unique sourceIdeaBlockId
      // конфликтует независимо от статуса существующего Decision (в т.ч.
      // superseded/rejected/cancelled), поэтому guard обязан ловить ЛЮБОЙ Decision
      // с этим sourceIdeaBlockId, иначе terminal-Decision снова уронит P2002.
      const alreadyMaterialized = await this.prisma.decision.findFirst({
        where: {
          tenantId: block.tenantId,
          OR: [
            { sourceIdeaBlockId: block.id },
            { sourceBlockIds: { has: block.id } },
          ],
        },
      });
      if (alreadyMaterialized) {
        try {
          await this.mergeIntoExisting({
            existing: alreadyMaterialized,
            draft,
            decidedByPersonIds,
            affectsEntityIds,
            sourceBlockIds,
            personSubjectIds,
          });
        } catch (err) {
          this.logger.warn(
            {
              blockId: block.id,
              decisionId: alreadyMaterialized.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-3: обогащение уже-материализованного решения упало — пропуск',
          );
        }
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-3-decisions',
          action: 'merged',
          message: `Decision уже материализован из блока ${block.id} — обогащён ${alreadyMaterialized.id}`,
          orgId: block.tenantId,
          details: {
            type: 'decision',
            intoId: alreadyMaterialized.id,
            blockId: block.id,
            reason: 'source_block_dedup',
          },
        });
        return;
      }

      // KNN-кандидаты + LLM supersede-detect.
      const candidates = await this.knnCandidates({
        tenantId: block.tenantId,
        queryText: `${draft.statement} ${draft.rationale ?? ''}`,
      });
      const verdict = await this.supersedeDetect({
        tenantId: block.tenantId,
        draft,
        candidates,
        dataClass: block.dataClass,
        blockId: block.id,
      });

      const status: DecisionStatus = (draft.status ??
        'approved') as DecisionStatus;
      const decidedAt = this.parseDate(draft.decidedAt);
      const deadline = this.parseDate(draft.deadline);

      // Применяем verdict.
      let decision: Decision;
      let createdNew = false;

      if (verdict.verdict === 'merge' && verdict.targetId) {
        const existing = await this.prisma.decision.findFirst({
          where: { id: verdict.targetId, tenantId: block.tenantId },
        });
        if (!existing) {
          decision = await this.createNewDecision({
            block,
            draft,
            decidedByPersonIds,
            affectsEntityIds,
            sourceBlockIds,
            personSubjectIds,
            status,
            decidedAt,
            deadline,
          });
          createdNew = true;
        } else {
          decision = await this.mergeIntoExisting({
            existing,
            draft,
            decidedByPersonIds,
            affectsEntityIds,
            sourceBlockIds,
            personSubjectIds,
          });
          this.logs.write({
            level: 'INFO',
            pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
            module: 'specialist-3-3-decisions',
            action: 'merged',
            message: `Decision слит в существующий ${existing.id}`,
            orgId: block.tenantId,
            details: {
              type: 'decision',
              intoId: existing.id,
              blockId: block.id,
            },
          });
        }
      } else if (verdict.verdict === 'supersedes' && verdict.targetId) {
        const existing = await this.prisma.decision.findFirst({
          where: { id: verdict.targetId, tenantId: block.tenantId },
        });
        if (!existing) {
          decision = await this.createNewDecision({
            block,
            draft,
            decidedByPersonIds,
            affectsEntityIds,
            sourceBlockIds,
            personSubjectIds,
            status,
            decidedAt,
            deadline,
          });
          createdNew = true;
        } else {
          const now = new Date();
          // validFrom для нового = decidedAt или now.
          const newValidFrom = decidedAt ?? now;
          const evolvingMeta = verdict.evolvingMeta ?? {
            existingValidUntil: now.toISOString(),
            newValidFrom: newValidFrom.toISOString(),
          };

          // Б49 — две критичные записи (create нового supersedesId=existing.id и
          // update старого → superseded + validUntil) обёрнуты в одну транзакцию,
          // чтобы не было рассинхрона (новый есть, старый не помечен) при сбое
          // между ними. reportEvolvingConflict и computeSupersedeChainLength —
          // follow-up, оставлены ПОСЛЕ транзакции. Внутри tx НЕ ловим P2002
          // (анти-паттерн Б1: абортит транзакцию); коллизию sourceIdeaBlockId уже
          // снял guard Б3 выше по методу для текущего block.id.
          decision = await this.prisma.$transaction(async (tx) => {
            // 1. Создаём новый Decision со ссылкой supersedesId.
            const created = await this.createNewDecision({
              block,
              draft,
              decidedByPersonIds,
              affectsEntityIds,
              sourceBlockIds,
              personSubjectIds,
              status,
              decidedAt,
              deadline,
              supersedesId: existing.id,
              validFrom: newValidFrom,
              tx,
            });
            // 2. Старый — помечаем superseded + validUntil.
            await tx.decision.update({
              where: { id: existing.id },
              data: {
                status: 'superseded',
                validUntil: new Date(evolvingMeta.existingValidUntil),
              },
            });
            return created;
          });
          createdNew = true;

          // 3. ConflictItem (evolving).
          await this.reportEvolvingConflict({
            tenantId: block.tenantId,
            existingId: existing.id,
            newId: decision.id,
            oldStatement: existing.statement ?? existing.text ?? '',
            newStatement: draft.statement,
            blockId: block.id,
            evolvingMeta,
          });

          // 4. Метрика длины цепочки.
          const chainLength = await this.computeSupersedeChainLength(
            decision.id,
          );
          this.metrics.observeDecisionSupersedeChainLength(chainLength);
        }
      } else {
        decision = await this.createNewDecision({
          block,
          draft,
          decidedByPersonIds,
          affectsEntityIds,
          sourceBlockIds,
          personSubjectIds,
          status,
          decidedAt,
          deadline,
        });
        createdNew = true;
      }

      // Embedding (best-effort).
      await this.tryWriteEmbedding({
        id: decision.id,
        text: `${draft.statement} ${draft.rationale ?? ''}`,
      });

      // Triage — Decision всегда critical → deep review.
      await this.triageProposed({
        tenantId: block.tenantId,
        resourceId: decision.id,
        confidence: draft.confidence,
        proposedPayload: {
          statement: draft.statement,
          rationale: draft.rationale,
          alternatives: draft.alternatives ?? [],
          decidedByPersonIds,
          decidedAt: decidedAt ? decidedAt.toISOString() : null,
          deadline: deadline ? deadline.toISOString() : null,
          status,
          supersedesId: decision.supersedesId,
          affectsEntityIds,
          sourceBlockIds: decision.sourceBlockIds,
          personSubjectIds: decision.personSubjectIds,
        },
        dataClass: block.dataClass,
        conflictSignal: verdict.verdict === 'supersedes' ? 'hard' : 'none',
      });

      if (createdNew) {
        this.logs.write({
          level: 'INFO',
          pipeline: SystemLogPipeline.KNOWLEDGE_GRAPH,
          module: 'specialist-3-3-decisions',
          action: 'created',
          message: `создан Decision ${decision.id}`,
          orgId: block.tenantId,
          details: {
            type: 'decision',
            entityId: decision.id,
            blockId: block.id,
          },
        });
      }

      // Probe-events (на новый и на merge — но только trigger'ы про текущее
      // состояние карточки, а не общестояночные).
      void createdNew;
      await this.probes.checkAndEmitForDecision(decision);
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'decision',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-3.processBlock: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  // ─────────────────────────── extraction ───────────────────────────

  private async extractDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
    contextQuotes: string[],
  ): Promise<DecisionDraft | null> {
    const start = Date.now();
    const quotes = block.evidence
      .slice(0, 6)
      .map((e) => e.quote)
      .filter((q) => q && q.length > 0);

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (контент блока + контекст-цитаты).
    const guardOnExtract = this.isPromptInjectionGuardEnabled();
    const rawUserExtract = DECISION_EXTRACT_USER_TEMPLATE({
      blockName: block.name,
      criticalQuestion: block.criticalQuestion,
      trustedAnswer: block.trustedAnswer,
      signalType: block.signalType,
      tags: block.tags,
      evidenceQuotes: quotes,
      contextQuotes,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'decision-extract',
        systemPrompt: guardOnExtract
          ? withInjectionGuard(DECISION_EXTRACT_SYSTEM_PROMPT)
          : DECISION_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOnExtract ? wrapUserData(rawUserExtract) : rawUserExtract,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: DECISION_EXTRACT_SCHEMA_NAME,
          schema: DECISION_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: block.id },
        dataClass: block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'decision',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-3.extractDraft: LLM упал — skip',
      );
      return null;
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'decision',
        seconds: (Date.now() - start) / 1000,
      });
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'decision',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: DecisionDraft | null;
    try {
      parsed = JSON.parse(result.text) as DecisionDraft;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'decision',
        reason: 'json_parse',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
          textSample: result.text.slice(0, 300),
        },
        'specialist-3-3.extractDraft: JSON.parse упал — skip',
      );
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.statement) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'decision',
        reason: 'schema_validation',
      });
      return null;
    }
    // C3 anti-плодёж: явный булев гейт. Срабатывает ТОЛЬКО на явный false —
    // модель не обязана фабриковать карточку, если решения в блоке нет.
    if (parsed.isDecision === false) {
      this.logger.debug(
        { blockId: block.id },
        'specialist-3-3.extractDraft: isDecision=false — это не решение, skip',
      );
      return null;
    }
    if ((parsed.confidence ?? 0) < Specialist33Service.MIN_EXTRACT_CONFIDENCE) {
      this.logger.debug(
        { blockId: block.id, confidence: parsed.confidence },
        'specialist-3-3.extractDraft: confidence слишком низкий — skip',
      );
      return null;
    }
    return parsed;
  }

  // ─────────────────────────── KNN + supersede-detect ───────────────────────────

  private async knnCandidates(args: {
    tenantId: string;
    queryText: string;
  }): Promise<DecisionKnnCandidate[]> {
    const queryText = args.queryText.trim().slice(0, 2_000);
    if (!queryText) return [];

    let embedding: number[] | null;
    try {
      embedding = await this.embedder.embedQuery(queryText);
    } catch {
      embedding = null;
    }

    if (embedding) {
      try {
        const vec = `[${embedding.join(',')}]`;
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{
            id: string;
            statement: string | null;
            rationale: string | null;
            decidedAt: Date | null;
            status: string;
            text: string | null;
          }>
        >(
          `SELECT "id", "statement", "rationale", "decidedAt", "status", "text"
           FROM "decisions"
           WHERE "tenantId" = $1
             AND "embedding" IS NOT NULL
             AND "status" NOT IN ('rejected','cancelled','superseded')
           ORDER BY "embedding" <=> $2::vector
           LIMIT ${Specialist33Service.KNN_TOP_K}`,
          args.tenantId,
          vec,
        );
        if (rows.length > 0) {
          return rows.map((r) => ({
            id: r.id,
            statement: r.statement ?? r.text ?? '',
            rationale: r.rationale,
            decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
            status: r.status,
          }));
        }
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-3.knnCandidates: pgvector KNN упал — fallback на name-like',
        );
      }
    }

    // Fallback — ILIKE по первым словам.
    const firstWords = queryText
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 2)
      .join(' ');
    if (!firstWords) return [];
    const rows = await this.prisma.decision.findMany({
      where: {
        tenantId: args.tenantId,
        OR: [
          { statement: { contains: firstWords, mode: 'insensitive' } },
          { text: { contains: firstWords, mode: 'insensitive' } },
        ],
        status: {
          notIn: ['rejected', 'cancelled', 'superseded'] as DecisionStatus[],
        },
      },
      select: {
        id: true,
        statement: true,
        text: true,
        rationale: true,
        decidedAt: true,
        status: true,
      },
      take: Specialist33Service.KNN_TOP_K,
    });
    return rows.map((r) => ({
      id: r.id,
      statement: r.statement ?? r.text ?? '',
      rationale: r.rationale,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      status: r.status,
    }));
  }

  private async supersedeDetect(args: {
    tenantId: string;
    draft: DecisionDraft;
    candidates: DecisionKnnCandidate[];
    dataClass: DataClass;
    blockId: string;
  }): Promise<SupersedeVerdict> {
    if (args.candidates.length === 0) {
      return { verdict: 'new', targetId: null, reasoning: 'нет кандидатов' };
    }

    // Agents v2 Фаза A2 (2026-05-30) — Multi-Agent Debate под флагом.
    // При MULTI_AGENT_DEBATE_ENABLED=true дёргаем 3-голосовый дебат-арбитр
    // вместо single LLM-вызова. Остальная цепочка (`apply verdict`) не меняется.
    // На split-verdict падаем на самый консервативный verdict='new', чтобы
    // не закрыть случайно existing Decision (escalate в curation через triage).
    if (this.cfg?.debate.enabled && this.debate) {
      try {
        const debateVerdict = await this.debate.judge({
          task: 'Является ли candidate-решение superseding existing decision? Verdict: new | merge | supersedes.',
          candidates: [
            {
              candidate: {
                statement: args.draft.statement,
                rationale: args.draft.rationale ?? null,
                decidedAt: args.draft.decidedAt ?? null,
              },
              knnTop5: args.candidates,
            },
          ],
          contextBlocks: [],
          taskType: 'debate-decision-supersede',
          tenantId: args.tenantId,
        });
        return this.mapDebateToSupersedeVerdict({
          debateVerdict,
          candidates: args.candidates,
          tenantId: args.tenantId,
        });
      } catch (err) {
        // Debate-цикл упал целиком — fallback на single LLM-call ниже.
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-3.supersedeDetect: debate.judge упал — fallback к single LLM-арбитру',
        );
      }
    }

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (draft + кандидаты) в маркеры.
    const guardOnSup = this.isPromptInjectionGuardEnabled();
    const rawUserSup = DECISION_SUPERSEDE_DETECT_USER_TEMPLATE({
      draft: {
        statement: args.draft.statement,
        rationale: args.draft.rationale ?? null,
        decidedAt: args.draft.decidedAt ?? null,
      },
      candidates: args.candidates,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'decision-supersede-detect',
        systemPrompt: guardOnSup
          ? withInjectionGuard(DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT)
          : DECISION_SUPERSEDE_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnSup ? wrapUserData(rawUserSup) : rawUserSup,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: DECISION_SUPERSEDE_DETECT_SCHEMA_NAME,
          schema: DECISION_SUPERSEDE_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: args.blockId },
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'decision',
        reason: 'arbiter_skip',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-3.supersedeDetect: LLM упал — fallback к verdict="new"',
      );
      return { verdict: 'new', targetId: null, reasoning: 'arbiter_skipped' };
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'decision',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: SupersedeVerdict;
    try {
      parsed = JSON.parse(result.text) as SupersedeVerdict;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'decision',
        reason: 'arbiter_json_parse',
      });
      return {
        verdict: 'new',
        targetId: null,
        reasoning: 'arbiter_parse_failed',
      };
    }

    // Sanity: target должен принадлежать candidates.
    const candidateIds = new Set(args.candidates.map((c) => c.id));
    if (
      parsed.verdict !== 'new' &&
      parsed.targetId &&
      !candidateIds.has(parsed.targetId)
    ) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          targetId: parsed.targetId,
          candidateIds: [...candidateIds],
        },
        'specialist-3-3.supersedeDetect: targetId не в candidates — fallback к "new"',
      );
      return {
        verdict: 'new',
        targetId: null,
        reasoning: 'targetId_not_in_candidates',
      };
    }
    return parsed;
  }

  /**
   * Маппинг {@link DebateVerdict} → внутренний {@link SupersedeVerdict}.
   *
   * Логика:
   *  - `consensusType ∈ {unanimous, majority}` AND verdict ∈ {new|merge|supersedes}
   *    → используем как есть. targetId восстанавливаем из первого голоса,
   *    у которого был targetId hint (если в reasoning попал id) — иначе
   *    из knnTop1 (fallback: candidates[0].id для merge/supersedes).
   *  - `consensusType='split'` (verdict='split_uncertain') → самый
   *    консервативный verdict='new' с reasoning, что debate не сошёлся.
   *    Triage в `processBlock` всё равно поднимет deep review (Decision —
   *    critical type), куратор увидит split-кейс.
   *  - Verdict из голосов, не входящий в {new|merge|supersedes} → 'new'.
   */
  private mapDebateToSupersedeVerdict(args: {
    debateVerdict: DebateVerdict;
    candidates: DecisionKnnCandidate[];
    tenantId: string;
  }): SupersedeVerdict {
    const { debateVerdict, candidates } = args;
    const supportedVerdicts = new Set(['new', 'merge', 'supersedes']);

    // Split / fallback — самый безопасный verdict.
    if (
      debateVerdict.consensusType === 'split' ||
      debateVerdict.fallbackUsed !== null ||
      !supportedVerdicts.has(debateVerdict.decision)
    ) {
      this.logger.log(
        {
          tenantId: args.tenantId,
          consensusType: debateVerdict.consensusType,
          decision: debateVerdict.decision,
          fallbackUsed: debateVerdict.fallbackUsed,
          rounds: debateVerdict.rounds,
          totalCostUsd: debateVerdict.totalCostUsd,
        },
        'specialist-3-3.mapDebateToSupersedeVerdict: split / fallback → verdict="new" (escalate в triage)',
      );
      return {
        verdict: 'new',
        targetId: null,
        reasoning:
          debateVerdict.consensusType === 'split'
            ? `debate_split:${debateVerdict.votes
                .map((v) => `${v.stance}=${v.verdict}`)
                .join(',')}`
            : `debate_fallback:${debateVerdict.fallbackUsed ?? 'unknown'}`,
      };
    }

    // Consensus verdict — для merge/supersedes нужен targetId. У debate'а
    // нет structured field'а под id, поэтому fallback к первому KNN-кандидату
    // (наиболее cosine-близкому). Это безопасно: arbiter уже подтвердил
    // verdict; targetId предположительно — top-1 (sanity-check сам выловит
    // если что).
    const decision = debateVerdict.decision as 'new' | 'merge' | 'supersedes';
    if (decision === 'new') {
      return {
        verdict: 'new',
        targetId: null,
        reasoning: `debate_consensus_${debateVerdict.consensusType}: new`,
      };
    }
    const targetId = candidates[0]?.id ?? null;
    if (!targetId) {
      return {
        verdict: 'new',
        targetId: null,
        reasoning: 'debate_consensus_without_candidate',
      };
    }
    return {
      verdict: decision,
      targetId,
      reasoning: `debate_consensus_${debateVerdict.consensusType}: ${decision}`,
    };
  }

  // ─────────────────────────── persist helpers ───────────────────────────

  private async createNewDecision(args: {
    block: IdeaBlock;
    draft: DecisionDraft;
    decidedByPersonIds: string[];
    affectsEntityIds: string[];
    sourceBlockIds: string[];
    personSubjectIds: string[];
    status: DecisionStatus;
    decidedAt: Date | null;
    deadline: Date | null;
    supersedesId?: string;
    validFrom?: Date;
    // Б49 — опциональный tx-клиент: чтобы create нового и update(старый→superseded)
    // в supersedes-ветке прошли в одной транзакции. По умолчанию this.prisma.
    tx?: Prisma.TransactionClient;
  }): Promise<Decision> {
    // W4.1/W4.2 — derive DataClass. Поведение зависит от
    // cfg.dataClassPolicy.enforcement:
    //   - 'off' / 'shadow' — пишем legacy (block.dataClass), compareWithLegacy
    //     эмитит метрику расхождения.
    //   - 'enforce' — пишем derive().dataClass и аудит. Legacy остаётся для
    //     compareWithLegacy метрики (`shadow_diff` уже не растёт, но видно
    //     насколько мы ушли от исторического правила).
    const legacyDc = args.block.dataClass;
    const enforcement = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const proposed = this.dataClassPolicy?.derive({
      sources: [
        {
          dataClass: args.block.dataClass,
          sourceId: args.block.id,
          sourceKind: 'idea_block',
        },
      ],
      context: { kind: 'decision' },
    });
    if (this.dataClassPolicy && proposed) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: legacyDc,
        proposedResult: proposed.dataClass,
        kind: 'decision',
        sourceIds: [args.block.id],
      });
    }
    const finalDc =
      enforcement === 'enforce' && proposed ? proposed.dataClass : legacyDc;
    const audit =
      enforcement === 'enforce' && proposed
        ? (proposed.audit as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    const db = args.tx ?? this.prisma;
    return db.decision.create({
      data: {
        tenantId: args.block.tenantId,
        // legacy text-поле — первые 1000 символов (для обратной совместимости).
        text: args.draft.statement.slice(0, 1_000),
        statement: args.draft.statement,
        rationale: args.draft.rationale ?? null,
        alternatives:
          args.draft.alternatives && args.draft.alternatives.length > 0
            ? (args.draft.alternatives as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        decidedByPersonIds: args.decidedByPersonIds,
        decidedAt: args.decidedAt,
        deadline: args.deadline,
        status: args.status,
        supersedesId: args.supersedesId ?? null,
        affectsEntityIds: args.affectsEntityIds,
        sourceBlockIds: args.sourceBlockIds,
        sourceIdeaBlockId: args.block.id,
        personSubjectIds: args.personSubjectIds,
        confidence: new Prisma.Decimal(
          Math.max(0, Math.min(1, args.draft.confidence)),
        ),
        dataClass: finalDc,
        dataClassAudit: audit,
        // Если в блоке есть один decidedByPerson — заполняем legacy-поле.
        decidedByPersonId: args.decidedByPersonIds[0] ?? null,
        validFrom: args.validFrom ?? args.decidedAt ?? null,
        // Pulse Wave 1 §1.2 — счётчик «сколько раз решение поднималось».
        raisedCount: 1,
        lastRaisedAt: new Date(),
      },
    });
  }

  private async mergeIntoExisting(args: {
    existing: Decision;
    draft: DecisionDraft;
    decidedByPersonIds: string[];
    affectsEntityIds: string[];
    sourceBlockIds: string[];
    personSubjectIds: string[];
  }): Promise<Decision> {
    const mergedAlternatives = this.mergeAlternatives(
      args.existing.alternatives,
      args.draft.alternatives ?? [],
    );
    return this.prisma.decision.update({
      where: { id: args.existing.id },
      data: {
        // rationale — append, если в существующем не было.
        rationale:
          args.existing.rationale ?? args.draft.rationale ?? undefined,
        statement: args.existing.statement ?? args.draft.statement,
        alternatives:
          mergedAlternatives.length > 0
            ? (mergedAlternatives as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        sourceBlockIds: {
          set: this.union(args.sourceBlockIds, args.existing.sourceBlockIds),
        },
        decidedByPersonIds: {
          set: this.union(
            args.decidedByPersonIds,
            args.existing.decidedByPersonIds,
          ),
        },
        affectsEntityIds: {
          set: this.union(
            args.affectsEntityIds,
            args.existing.affectsEntityIds,
          ),
        },
        personSubjectIds: {
          set: this.union(args.personSubjectIds, args.existing.personSubjectIds),
        },
        lastConfirmedAt: new Date(),
        // Pulse Wave 1 §1.2 — решение поднялось ещё раз (merge-событие).
        raisedCount: { increment: 1 },
        lastRaisedAt: new Date(),
      },
    });
  }

  private mergeAlternatives(
    existing: Prisma.JsonValue | null,
    incoming: ReadonlyArray<{
      option: string;
      reasonRejected?: string | null;
    }>,
  ): Array<{ option: string; reasonRejected: string | null }> {
    const result: Array<{ option: string; reasonRejected: string | null }> = [];
    const seen = new Set<string>();
    const addIfFresh = (option: string, reasonRejected: string | null) => {
      const key = option.trim().toLowerCase();
      if (!key || seen.has(key)) return;
      seen.add(key);
      result.push({ option: option.trim(), reasonRejected });
    };

    if (Array.isArray(existing)) {
      for (const e of existing) {
        if (e && typeof e === 'object' && !Array.isArray(e)) {
          const obj = e as { option?: unknown; reasonRejected?: unknown };
          if (typeof obj.option === 'string') {
            addIfFresh(
              obj.option,
              typeof obj.reasonRejected === 'string' ? obj.reasonRejected : null,
            );
          }
        }
      }
    }
    for (const i of incoming) {
      addIfFresh(i.option, i.reasonRejected ?? null);
    }
    return result;
  }

  // ─────────────────────────── resolvers ───────────────────────────

  private async resolveDecidedByPersons(args: {
    tenantId: string;
    hints: readonly string[];
    blockId: string;
  }): Promise<string[]> {
    const personIds = new Set<string>();

    // Сначала — name-match по Person.relationship='employee' (если есть Person).
    for (const hint of args.hints) {
      const trimmed = hint.trim();
      if (trimmed.length < 2) continue;
      try {
        const person = await this.prisma.person.findFirst({
          where: {
            tenantId: args.tenantId,
            deletedAt: null,
            name: { contains: trimmed, mode: 'insensitive' },
            // Предпочитаем сотрудников; но если нет employee — возьмём любого.
          },
          orderBy: { relationship: 'asc' },
          select: { id: true },
        });
        if (person) {
          personIds.add(person.id);
        }
      } catch (err) {
        this.logger.debug(
          { hint, err: err instanceof Error ? err.message : String(err) },
          'specialist-3-3.resolveDecidedByPersons: person-lookup упал',
        );
      }
    }

    // Если ничего не нашли по hint'ам — пробуем взять subject-Person'ы из блока
    // (через IdeaBlockEntity → Entity{type=person} → Person).
    if (personIds.size === 0) {
      try {
        const subjectMentions = await this.prisma.ideaBlockEntity.findMany({
          where: {
            blockId: args.blockId,
            role: 'subject',
            entity: { type: 'person' },
          },
          select: { entityId: true },
        });
        if (subjectMentions.length > 0) {
          const persons = await this.prisma.person.findMany({
            where: {
              entityId: { in: subjectMentions.map((m) => m.entityId) },
              tenantId: args.tenantId,
              deletedAt: null,
            },
            select: { id: true },
          });
          for (const p of persons) personIds.add(p.id);
        }
      } catch {
        // best-effort
      }
    }

    return [...personIds];
  }

  private async resolveAffectsEntities(args: {
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
      // 'process' пока не Entity (Process — отдельная таблица); скипаем.
      if (!SUPPORTED_TYPES.has(type)) continue;
      try {
        const { entity } = await this.entities.findOrCreateEntity({
          tenantId: args.tenantId,
          // Cast: type уже отфильтрован SUPPORTED_TYPES.
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
          'specialist-3-3.resolveAffectsEntities: findOrCreate упал — skip',
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

  // ─────────────────────────── conflicts ───────────────────────────

  private async reportEvolvingConflict(args: {
    tenantId: string;
    existingId: string;
    newId: string;
    oldStatement: string;
    newStatement: string;
    blockId: string;
    evolvingMeta: { existingValidUntil: string; newValidFrom: string };
  }): Promise<void> {
    try {
      await this.conflicts.report({
        tenantId: args.tenantId,
        resourceType: 'decision',
        existingId: args.existingId,
        newId: args.newId,
        relationType: 'supersedes',
        detectedBy: 'specialist',
        evidence: {
          specialistName: Specialist33Service.SPECIALIST_NAME,
          oldStatement: args.oldStatement.slice(0, 1_000),
          newStatement: args.newStatement.slice(0, 1_000),
          sourceBlockIds: [args.blockId],
          suggestedResolution: 'evolving',
          evolvingMeta: args.evolvingMeta,
        },
      });
      this.metrics.incCoreSpecialistConflictEvent({ type: 'decision' });
      this.metrics.incCoreSpecialistConflictEvolving({ type: 'decision' });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-3.reportEvolvingConflict: упал — пропускаю',
      );
    }
  }

  private async computeSupersedeChainLength(
    decisionId: string,
  ): Promise<number> {
    // Идём вверх по supersedesId, считаем шаги (cap 100, защита от циклов).
    let cur: string | null = decisionId;
    let length = 0;
    const seen = new Set<string>();
    while (cur && length < 100) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const next: { supersedesId: string | null } | null =
        await this.prisma.decision.findUnique({
          where: { id: cur },
          select: { supersedesId: true },
        });
      if (!next?.supersedesId) break;
      length += 1;
      cur = next.supersedesId;
    }
    return length;
  }

  // ─────────────────────────── triage ───────────────────────────

  private async triageProposed(args: {
    tenantId: string;
    resourceId: string;
    confidence: number;
    proposedPayload: Record<string, unknown>;
    dataClass: DataClass;
    conflictSignal: 'none' | 'soft' | 'hard';
  }): Promise<void> {
    try {
      await this.curation.triage({
        tenantId: args.tenantId,
        resourceType: 'decision',
        resourceId: args.resourceId,
        confidence: Math.min(1, Math.max(0, args.confidence)),
        proposedPayload: args.proposedPayload,
        conflictSignal: args.conflictSignal,
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
        'specialist-3-3.triage: упал — карточка осталась без CurationItem',
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
        `UPDATE "decisions" SET "embedding" = $1::vector WHERE "id" = $2`,
        vecStr,
        args.id,
      );
    } catch (err) {
      this.logger.debug(
        {
          id: args.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-3.tryWriteEmbedding: пропускаю (best-effort)',
      );
    }
  }

  // ─────────────────────────── context window ───────────────────────────

  /**
   * Цитаты блоков ±2 минуты от текущего блока в той же RawEvent-источнике
   * (встреча / документ / чат). Помогают LLM найти rationale, который может
   * лежать в соседних блоках reasoning.
   *
   * Алгоритм:
   *   1. Берём evidence текущего блока — узнаём rawEventId + sourceTimestamp.
   *   2. Ищем другие IdeaBlockEvidence с тем же rawEventId в окне
   *      sourceTimestamp ± CONTEXT_WINDOW_MS.
   *   3. Берём IdeaBlock'и этих evidence, собираем trustedAnswer + цитаты.
   */
  private async loadContextQuotes(block: IdeaBlock): Promise<string[]> {
    try {
      const ev = await this.prisma.ideaBlockEvidence.findFirst({
        where: { blockId: block.id, sourceTimestamp: { not: null } },
        orderBy: { sourceTimestamp: 'asc' },
        select: { rawEventId: true, sourceTimestamp: true },
      });
      if (!ev || !ev.sourceTimestamp) return [];
      const startMs = ev.sourceTimestamp.getTime();
      const windowStart = new Date(
        startMs - Specialist33Service.CONTEXT_WINDOW_MS,
      );
      const windowEnd = new Date(
        startMs + Specialist33Service.CONTEXT_WINDOW_MS,
      );

      const neighbors = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          rawEventId: ev.rawEventId,
          sourceTimestamp: { gte: windowStart, lte: windowEnd },
          NOT: { blockId: block.id },
        },
        select: {
          quote: true,
          block: { select: { name: true, trustedAnswer: true } },
        },
        take: 12,
        orderBy: { sourceTimestamp: 'asc' },
      });
      const quotes: string[] = [];
      const seenBlocks = new Set<string>();
      for (const n of neighbors) {
        const blockKey = `${n.block.name}::${n.block.trustedAnswer ?? ''}`;
        if (!seenBlocks.has(blockKey) && n.block.trustedAnswer) {
          quotes.push(
            `${n.block.name}: ${n.block.trustedAnswer}`.slice(0, 400),
          );
          seenBlocks.add(blockKey);
        }
        if (n.quote) quotes.push(n.quote.slice(0, 400));
      }
      return quotes.slice(0, 8);
    } catch {
      return [];
    }
  }

  // ─────────────────────────── utils ───────────────────────────

  private parseDate(input: string | null | undefined): Date | null {
    if (!input) return null;
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  }

  private union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
  }
}

// ─────────────────────────── shared types ───────────────────────────

export interface DecisionDraft {
  isDecision?: boolean;
  statement: string;
  rationale?: string | null;
  alternatives?: Array<{ option: string; reasonRejected?: string | null }>;
  decidedByPersonHints?: string[];
  affectsEntityHints?: Array<{ name: string; type: string }>;
  decidedAt?: string | null;
  deadline?: string | null;
  status?: DecisionStatus | string | null;
  confidence: number;
}

interface DecisionKnnCandidate {
  id: string;
  statement: string;
  rationale: string | null;
  decidedAt: string | null;
  status: string;
}

interface SupersedeVerdict {
  verdict: 'new' | 'merge' | 'supersedes';
  targetId: string | null;
  reasoning: string;
  evolvingMeta?: {
    existingValidUntil: string;
    newValidFrom: string;
  };
}
