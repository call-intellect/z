import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type IdeaBlock,
  type IdeaBlockEntity,
  type IdeaBlockEvidence,
  type Policy,
  type Process,
  Prisma,
  type Regulation,
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
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import {
  REGULATION_DEDUPE_JSON_SCHEMA,
  REGULATION_DEDUPE_SCHEMA_NAME,
  REGULATION_DEDUPE_SYSTEM_PROMPT,
  REGULATION_DEDUPE_USER_TEMPLATE,
} from '../prompts/regulation-dedupe.prompt';
import {
  REGULATION_EXTRACT_JSON_SCHEMA,
  REGULATION_EXTRACT_SCHEMA_NAME,
  REGULATION_EXTRACT_SYSTEM_PROMPT,
  REGULATION_EXTRACT_USER_TEMPLATE,
} from '../prompts/regulation-extract.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';
import { KnowledgeEmbeddingService } from './embedding.service';
import { Specialist31ProbeService } from './specialist-3-1-probe.service';

/**
 * SBA α-7 — Specialist31Service.
 *
 * Логика специалиста 3.1: блок (signalType='regulation'/'process_step'/'policy')
 * → черновик карточки (Regulation/Process/Policy) → KNN+LLM-дедуп → triage →
 * (auto-canonical / curation review) → probe-events / conflict-events.
 *
 * Решение по моделям данных (см. план α-7):
 *   - НЕ создавать новую таблицу `Regulation` с `kind`. Расширяем существующие
 *     `Process`, `Regulation`, `Policy` (Phase 0b) новыми полями in-place.
 *   - Specialist 3.1 пишет в нужную таблицу по `signalType`:
 *       - 'regulation' → Regulation (kind='regulation'/'standard')
 *       - 'process_step' → Process + ProcessStep
 *       - 'policy' (резерв) → Policy
 *   - Параллельно работает legacy block-ingest.worker (Phase 0b extraction'а),
 *     который создаёт эти же записи через `GraphService.upsertEntity`. Это
 *     ОЖИДАЕМОЕ дублирование: legacy создаёт минимальные записи (name+content),
 *     специалист 3.1 их обогащает (statement, scope, ownerHint, sourceBlockIds,
 *     personSubjectIds, embedding) через `merge`-арбитра.
 *
 * Контракт §5:
 *   1. consumer `core.specialist-routing` jobName='3-1-regulations' (worker).
 *   2. Prisma-модели — Process/Regulation/Policy (in-place extension).
 *   3. triage перед канонизацией — все три типа в CURATION_CRITICAL_TYPES_DEFAULT
 *      → всегда deep review.
 *   4. probe-events — Specialist31ProbeService (4 trigger'а: missing_owner /
 *      process_no_steps / stale / scope_unclear).
 *   5. conflict-events — `ConflictService.report` при LLM-arbiter
 *      decision='contradicts'.
 *   6. chat-v2 support — Specialist31CardHandler (через CardSpecialistRegistry).
 *   7. metrics — `core_specialist_*` + `core_specialist_extraction_failures_total`.
 */
@Injectable()
export class Specialist31Service {
  private readonly logger = new Logger(Specialist31Service.name);

  /** Имя специалиста (соответствует RouterService.SPECIALIST.REGULATIONS). */
  static readonly SPECIALIST_NAME = '3-1-regulations';
  /** Top-K для cosine KNN арбитра дедупа. */
  private static readonly KNN_TOP_K = 5;
  /** Минимальная уверенность LLM-extraction, ниже которой пропускаем триаж. */
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(Specialist31ProbeService)
    private readonly probes: Specialist31ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    // W4.1 — DataClassPolicyService для shadow-compare. @Optional, потому что
    // unit-тесты могут не поднимать KnowledgeCoreModule целиком.
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
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

  // ──────────────── публичные методы (вызываются из воркера) ────────────────

  /**
   * Обработка блока `signalType='regulation'`. Извлекает черновик → дедуп →
   * triage в Regulation (kind='regulation' | 'standard').
   */
  async processRegulationBlock(
    block: IdeaBlock & {
      evidence: IdeaBlockEvidence[];
      entities: IdeaBlockEntity[];
    },
  ): Promise<void> {
    const draft = await this.extractDraft(block);
    if (!draft) return;
    if (draft.kind !== 'regulation' && draft.kind !== 'standard') {
      // LLM решила, что блок — про process / policy. Делегируем соответствующий
      // путь. Это рассматривается как «misrouted» сигнал, но не failure.
      if (draft.kind === 'process') {
        await this.upsertProcess(block, draft);
        return;
      }
      if (draft.kind === 'policy') {
        await this.upsertPolicy(block, draft);
        return;
      }
    }
    await this.upsertRegulation(block, draft);
  }

  /**
   * Обработка блока `signalType='process_step'`. Извлекает черновик → дедуп →
   * triage в Process (+ ProcessStep — отдельный LLM-вызов опционально).
   */
  async processProcessStepBlock(
    block: IdeaBlock & {
      evidence: IdeaBlockEvidence[];
      entities: IdeaBlockEntity[];
    },
  ): Promise<void> {
    const draft = await this.extractDraft(block);
    if (!draft) return;
    if (draft.kind !== 'process') {
      // LLM думает иначе. Если regulation/policy/standard — делегируем.
      if (draft.kind === 'regulation' || draft.kind === 'standard') {
        await this.upsertRegulation(block, draft);
        return;
      }
      if (draft.kind === 'policy') {
        await this.upsertPolicy(block, draft);
        return;
      }
    }
    await this.upsertProcess(block, draft);
  }

  /**
   * Обработка блока с `signalType='policy'` (на текущий момент NB:
   * Layer-1 разметка возможно не выделяет 'policy' как отдельный signalType
   * — в Фазе 0b всё идёт через 'regulation'. Метод оставлен для готовности
   * к расширению Layer-1 в β-/γ-).
   */
  async processPolicyBlock(
    block: IdeaBlock & {
      evidence: IdeaBlockEvidence[];
      entities: IdeaBlockEntity[];
    },
  ): Promise<void> {
    const draft = await this.extractDraft(block);
    if (!draft) return;
    if (draft.kind !== 'policy') {
      if (draft.kind === 'regulation' || draft.kind === 'standard') {
        await this.upsertRegulation(block, draft);
        return;
      }
      if (draft.kind === 'process') {
        await this.upsertProcess(block, draft);
        return;
      }
    }
    await this.upsertPolicy(block, draft);
  }

  // ──────────────────────── extraction (общая) ────────────────────────

  private async extractDraft(
    block: IdeaBlock & {
      evidence: IdeaBlockEvidence[];
    },
  ): Promise<RegulationDraft | null> {
    const start = Date.now();
    const quotes = block.evidence
      .slice(0, 6)
      .map((e) => e.quote)
      .filter((q) => q && q.length > 0);

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (контент блока) в маркеры.
    const guardOnExtract = this.isPromptInjectionGuardEnabled();
    const rawUserExtract = REGULATION_EXTRACT_USER_TEMPLATE({
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
        taskType: 'regulation-extract',
        systemPrompt: guardOnExtract
          ? withInjectionGuard(REGULATION_EXTRACT_SYSTEM_PROMPT)
          : REGULATION_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOnExtract ? wrapUserData(rawUserExtract) : rawUserExtract,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: REGULATION_EXTRACT_SCHEMA_NAME,
          schema: REGULATION_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: block.id },
        dataClass: block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'regulation',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.extractDraft: LLM упал — skip',
      );
      return null;
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'regulation',
        seconds: (Date.now() - start) / 1000,
      });
    }

    // Метрика токенов специалиста.
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'regulation',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: RegulationDraft | null;
    try {
      parsed = JSON.parse(result.text) as RegulationDraft;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'regulation',
        reason: 'json_parse',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
          textSample: result.text.slice(0, 300),
        },
        'specialist-3-1.extractDraft: JSON.parse упал — skip',
      );
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.name || !parsed.statement) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'regulation',
        reason: 'schema_validation',
      });
      return null;
    }
    if ((parsed.confidence ?? 0) < Specialist31Service.MIN_EXTRACT_CONFIDENCE) {
      this.logger.debug(
        { blockId: block.id, confidence: parsed.confidence },
        'specialist-3-1.extractDraft: confidence слишком низкий — skip',
      );
      return null;
    }
    return parsed;
  }

  // ──────────────────────── upsert per-kind ────────────────────────

  private async upsertRegulation(
    block: IdeaBlock,
    draft: RegulationDraft,
  ): Promise<void> {
    try {
      const candidates = await this.knnCandidates({
        tenantId: block.tenantId,
        table: 'regulation',
        nameQuery: `${draft.name} ${draft.statement}`,
      });

      const verdict = await this.dedupeArbiter({
        tenantId: block.tenantId,
        draft,
        candidates,
        dataClass: block.dataClass,
        blockId: block.id,
      });

      const ownerPersonId = await this.resolveOwnerPersonHint(
        block.tenantId,
        draft.ownerHint,
      );
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      let regulation: Regulation;
      const dcRes = this.deriveDataClassForPersist({
        blockId: block.id,
        blockDataClass: block.dataClass,
        kind: 'regulation',
      });

      if (verdict.decision === 'new' || !verdict.targetId) {
        regulation = await this.prisma.regulation.upsert({
          where: {
            tenantId_name: { tenantId: block.tenantId, name: draft.name },
          },
          update: {
            statement: draft.statement,
            scope: draft.scope ?? undefined,
            ownerPersonId: ownerPersonId ?? undefined,
            sourceBlockIds: { set: this.union(sourceBlockIds, []) },
            personSubjectIds: { set: this.union(personSubjectIds, []) },
            dataClass: dcRes.dataClass,
            dataClassAudit: dcRes.dataClassAudit,
            confidence: draft.confidence ?? null,
            category: draft.category === 'standard' ? 'standard' : 'regulation',
          },
          create: {
            tenantId: block.tenantId,
            name: draft.name,
            contentMd: draft.statement,
            statement: draft.statement,
            category: draft.category === 'standard' ? 'standard' : 'regulation',
            confidence: draft.confidence ?? null,
            scope: draft.scope ?? null,
            ownerPersonId: ownerPersonId ?? null,
            sourceBlockIds,
            personSubjectIds,
            dataClass: dcRes.dataClass,
            dataClassAudit: dcRes.dataClassAudit,
          },
        });
      } else {
        // merge / extension / contradicts → загружаем существующую и обновляем.
        const existing = await this.prisma.regulation.findUnique({
          where: { id: verdict.targetId },
        });
        if (!existing) {
          // Кандидат пропал — fallback к 'new'.
          regulation = await this.prisma.regulation.upsert({
            where: {
              tenantId_name: { tenantId: block.tenantId, name: draft.name },
            },
            update: {
              sourceBlockIds: { set: this.union(sourceBlockIds, []) },
            },
            create: {
              tenantId: block.tenantId,
              name: draft.name,
              contentMd: draft.statement,
              statement: draft.statement,
              category:
                draft.category === 'standard' ? 'standard' : 'regulation',
              confidence: draft.confidence ?? null,
              scope: draft.scope ?? null,
              ownerPersonId: ownerPersonId ?? null,
              sourceBlockIds,
              personSubjectIds,
              dataClass: dcRes.dataClass,
              dataClassAudit: dcRes.dataClassAudit,
            },
          });
        } else {
          regulation = await this.prisma.regulation.update({
            where: { id: existing.id },
            data: {
              statement: draft.statement,
              scope: draft.scope ?? existing.scope ?? undefined,
              ownerPersonId:
                ownerPersonId ?? existing.ownerPersonId ?? undefined,
              sourceBlockIds: {
                set: this.union(sourceBlockIds, existing.sourceBlockIds),
              },
              personSubjectIds: {
                set: this.union(personSubjectIds, existing.personSubjectIds),
              },
              confidence: draft.confidence ?? existing.confidence,
            },
          });
          if (verdict.decision === 'contradicts') {
            await this.reportContradiction({
              tenantId: block.tenantId,
              resourceType: 'regulation',
              existingId: existing.id,
              draftId: regulation.id,
              draftName: draft.name,
              oldStatement: existing.statement ?? existing.contentMd,
              newStatement: draft.statement,
              blockId: block.id,
            });
          }
        }
      }

      // 6. Эмбеддинг (best-effort, не блокирует triage).
      await this.tryWriteEmbedding({
        table: 'regulation',
        id: regulation.id,
        text: `${draft.name} ${draft.statement}`,
      });

      // 7. Triage — Regulation в critical → deep review.
      await this.triageProposed({
        tenantId: block.tenantId,
        resourceType: 'regulation',
        resourceId: regulation.id,
        confidence: draft.confidence ?? 0.6,
        proposedPayload: {
          name: regulation.name,
          statement: draft.statement,
          category: regulation.category,
          scope: regulation.scope,
          ownerPersonId: regulation.ownerPersonId,
          sourceBlockIds: regulation.sourceBlockIds,
          personSubjectIds: regulation.personSubjectIds,
        },
        conflictSignal: verdict.decision === 'contradicts' ? 'hard' : 'none',
        dataClass: block.dataClass,
        sourceBlockId: block.id,
      });

      // 8. Probe-events.
      await this.probes.checkAndEmitProbesRegulation(regulation);
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'regulation',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.upsertRegulation: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  private async upsertProcess(
    block: IdeaBlock,
    draft: RegulationDraft,
  ): Promise<void> {
    try {
      const candidates = await this.knnCandidates({
        tenantId: block.tenantId,
        table: 'process',
        nameQuery: `${draft.name} ${draft.statement}`,
      });

      const verdict = await this.dedupeArbiter({
        tenantId: block.tenantId,
        draft,
        candidates,
        dataClass: block.dataClass,
        blockId: block.id,
      });

      const ownerPersonId = await this.resolveOwnerPersonHint(
        block.tenantId,
        draft.ownerHint,
      );
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      let proc: Process;

      // Для process: имя берём из processStepHint.processName (приоритет),
      // иначе draft.name.
      const processName = draft.processStepHint?.processName ?? draft.name;

      const dcResProc = this.deriveDataClassForPersist({
        blockId: block.id,
        blockDataClass: block.dataClass,
        kind: 'process',
      });
      if (verdict.decision === 'new' || !verdict.targetId) {
        proc = await this.prisma.process.upsert({
          where: {
            tenantId_name: { tenantId: block.tenantId, name: processName },
          },
          update: {
            description: draft.statement,
            scope: draft.scope ?? undefined,
            ownerPersonId: ownerPersonId ?? undefined,
            sourceBlockIds: { set: this.union(sourceBlockIds, []) },
            personSubjectIds: { set: this.union(personSubjectIds, []) },
            dataClass: dcResProc.dataClass,
            dataClassAudit: dcResProc.dataClassAudit,
            confidence: draft.confidence ?? null,
          },
          create: {
            tenantId: block.tenantId,
            name: processName,
            description: draft.statement,
            scope: draft.scope ?? null,
            ownerPersonId: ownerPersonId ?? null,
            sourceBlockIds,
            personSubjectIds,
            dataClass: dcResProc.dataClass,
            dataClassAudit: dcResProc.dataClassAudit,
            confidence: draft.confidence ?? null,
          },
        });
      } else {
        const existing = await this.prisma.process.findUnique({
          where: { id: verdict.targetId },
        });
        if (!existing) {
          proc = await this.prisma.process.upsert({
            where: {
              tenantId_name: { tenantId: block.tenantId, name: processName },
            },
            update: { sourceBlockIds: { set: this.union(sourceBlockIds, []) } },
            create: {
              tenantId: block.tenantId,
              name: processName,
              description: draft.statement,
              scope: draft.scope ?? null,
              ownerPersonId: ownerPersonId ?? null,
              sourceBlockIds,
              personSubjectIds,
              dataClass: dcResProc.dataClass,
              dataClassAudit: dcResProc.dataClassAudit,
              confidence: draft.confidence ?? null,
            },
          });
        } else {
          proc = await this.prisma.process.update({
            where: { id: existing.id },
            data: {
              description: existing.description ?? draft.statement,
              scope: draft.scope ?? existing.scope ?? undefined,
              ownerPersonId:
                ownerPersonId ?? existing.ownerPersonId ?? undefined,
              sourceBlockIds: {
                set: this.union(sourceBlockIds, existing.sourceBlockIds),
              },
              personSubjectIds: {
                set: this.union(personSubjectIds, existing.personSubjectIds),
              },
              confidence: draft.confidence ?? existing.confidence,
            },
          });
          if (verdict.decision === 'contradicts') {
            await this.reportContradiction({
              tenantId: block.tenantId,
              resourceType: 'process',
              existingId: existing.id,
              draftId: proc.id,
              draftName: draft.name,
              oldStatement: existing.description ?? '',
              newStatement: draft.statement,
              blockId: block.id,
            });
          }
        }
      }

      // ProcessStep — если в черновике пришёл processStepHint, создаём один шаг.
      // Полное извлечение всех шагов будет через `process-steps-extract`, но это
      // отдельный pass поверх группы блоков. На α-7 — простой single-step upsert.
      if (draft.processStepHint) {
        await this.upsertSingleProcessStep({
          tenantId: block.tenantId,
          processId: proc.id,
          hint: draft.processStepHint,
        });
      }

      await this.tryWriteEmbedding({
        table: 'process',
        id: proc.id,
        text: `${proc.name} ${proc.description ?? ''}`,
      });

      await this.triageProposed({
        tenantId: block.tenantId,
        resourceType: 'process',
        resourceId: proc.id,
        confidence: draft.confidence ?? 0.6,
        proposedPayload: {
          name: proc.name,
          description: proc.description,
          scope: proc.scope,
          ownerPersonId: proc.ownerPersonId,
          sourceBlockIds: proc.sourceBlockIds,
          personSubjectIds: proc.personSubjectIds,
        },
        conflictSignal: verdict.decision === 'contradicts' ? 'hard' : 'none',
        dataClass: block.dataClass,
        sourceBlockId: block.id,
      });

      await this.probes.checkAndEmitProbesProcess(proc);
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'process',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.upsertProcess: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  private async upsertPolicy(
    block: IdeaBlock,
    draft: RegulationDraft,
  ): Promise<void> {
    try {
      const candidates = await this.knnCandidates({
        tenantId: block.tenantId,
        table: 'policy',
        nameQuery: `${draft.name} ${draft.statement}`,
      });

      const verdict = await this.dedupeArbiter({
        tenantId: block.tenantId,
        draft,
        candidates,
        dataClass: block.dataClass,
        blockId: block.id,
      });

      const ownerPersonId = await this.resolveOwnerPersonHint(
        block.tenantId,
        draft.ownerHint,
      );
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      // Маппинг severity LLM → Prisma enum.
      const severityMap: Record<string, 'advisory' | 'mandatory' | 'blocking'> =
        {
          advisory: 'advisory',
          mandatory: 'mandatory',
          blocking: 'blocking',
          // legacy LLM-вариант:
          critical: 'blocking',
          recommended: 'advisory',
          standard: 'mandatory',
        };
      const severity = draft.severity
        ? severityMap[draft.severity] ?? 'advisory'
        : 'advisory';

      let policy: Policy;

      const dcResPol = this.deriveDataClassForPersist({
        blockId: block.id,
        blockDataClass: block.dataClass,
        kind: 'policy',
      });
      if (verdict.decision === 'new' || !verdict.targetId) {
        policy = await this.prisma.policy.upsert({
          where: {
            tenantId_name: { tenantId: block.tenantId, name: draft.name },
          },
          update: {
            contentMd: draft.statement,
            severity,
            scope: draft.scope ?? undefined,
            ownerPersonId: ownerPersonId ?? undefined,
            sourceBlockIds: { set: this.union(sourceBlockIds, []) },
            personSubjectIds: { set: this.union(personSubjectIds, []) },
            dataClass: dcResPol.dataClass,
            dataClassAudit: dcResPol.dataClassAudit,
            confidence: draft.confidence ?? null,
          },
          create: {
            tenantId: block.tenantId,
            name: draft.name,
            contentMd: draft.statement,
            severity,
            scope: draft.scope ?? null,
            ownerPersonId: ownerPersonId ?? null,
            sourceBlockIds,
            personSubjectIds,
            dataClass: dcResPol.dataClass,
            dataClassAudit: dcResPol.dataClassAudit,
            confidence: draft.confidence ?? null,
          },
        });
      } else {
        const existing = await this.prisma.policy.findUnique({
          where: { id: verdict.targetId },
        });
        if (!existing) {
          policy = await this.prisma.policy.upsert({
            where: {
              tenantId_name: { tenantId: block.tenantId, name: draft.name },
            },
            update: { sourceBlockIds: { set: this.union(sourceBlockIds, []) } },
            create: {
              tenantId: block.tenantId,
              name: draft.name,
              contentMd: draft.statement,
              severity,
              scope: draft.scope ?? null,
              ownerPersonId: ownerPersonId ?? null,
              sourceBlockIds,
              personSubjectIds,
              dataClass: dcResPol.dataClass,
              dataClassAudit: dcResPol.dataClassAudit,
              confidence: draft.confidence ?? null,
            },
          });
        } else {
          policy = await this.prisma.policy.update({
            where: { id: existing.id },
            data: {
              contentMd: draft.statement,
              severity: severity ?? existing.severity,
              scope: draft.scope ?? existing.scope ?? undefined,
              ownerPersonId:
                ownerPersonId ?? existing.ownerPersonId ?? undefined,
              sourceBlockIds: {
                set: this.union(sourceBlockIds, existing.sourceBlockIds),
              },
              personSubjectIds: {
                set: this.union(personSubjectIds, existing.personSubjectIds),
              },
              confidence: draft.confidence ?? existing.confidence,
            },
          });
          if (verdict.decision === 'contradicts') {
            await this.reportContradiction({
              tenantId: block.tenantId,
              resourceType: 'policy',
              existingId: existing.id,
              draftId: policy.id,
              draftName: draft.name,
              oldStatement: existing.contentMd,
              newStatement: draft.statement,
              blockId: block.id,
            });
          }
        }
      }

      await this.tryWriteEmbedding({
        table: 'policy',
        id: policy.id,
        text: `${policy.name} ${policy.contentMd}`,
      });

      await this.triageProposed({
        tenantId: block.tenantId,
        resourceType: 'policy',
        resourceId: policy.id,
        confidence: draft.confidence ?? 0.6,
        proposedPayload: {
          name: policy.name,
          contentMd: policy.contentMd,
          severity: policy.severity,
          scope: policy.scope,
          ownerPersonId: policy.ownerPersonId,
          sourceBlockIds: policy.sourceBlockIds,
          personSubjectIds: policy.personSubjectIds,
        },
        conflictSignal: verdict.decision === 'contradicts' ? 'hard' : 'none',
        dataClass: block.dataClass,
        sourceBlockId: block.id,
      });

      await this.probes.checkAndEmitProbesPolicy(policy);
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'policy',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.upsertPolicy: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  // ──────────────────────── helpers ────────────────────────

  /**
   * KNN cosine top-K по embedding'у — но если embedding отсутствует, fallback
   * к простому name-LIKE через ILIKE. На pre-prod без HNSW-индекса (или с
   * пустыми embedding'ами) — name-fallback всё равно даёт работоспособный
   * dedupe-арбитр.
   */
  private async knnCandidates(args: {
    tenantId: string;
    table: 'regulation' | 'process' | 'policy';
    nameQuery: string;
  }): Promise<KnnCandidate[]> {
    const queryText = args.nameQuery.trim().slice(0, 1_000);
    if (!queryText) return [];

    // Попытка KNN через pgvector (raw SQL): требует embedding в строке.
    let queryEmbedding: number[] | null;
    try {
      queryEmbedding = await this.embedder.embedQuery(queryText);
    } catch {
      queryEmbedding = null;
    }

    if (queryEmbedding) {
      try {
        const candidates = await this.knnByEmbedding({
          tenantId: args.tenantId,
          table: args.table,
          embedding: queryEmbedding,
        });
        if (candidates.length > 0) return candidates;
      } catch (err) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            table: args.table,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-1.knnCandidates: pgvector KNN упал — fallback на name-like',
        );
      }
    }

    return this.knnByNameLike({
      tenantId: args.tenantId,
      table: args.table,
      nameQuery: queryText,
    });
  }

  private async knnByEmbedding(args: {
    tenantId: string;
    table: 'regulation' | 'process' | 'policy';
    embedding: number[];
  }): Promise<KnnCandidate[]> {
    const tableMap: Record<string, string> = {
      regulation: '"regulations"',
      process: '"processes"',
      policy: '"policies"',
    };
    const table = tableMap[args.table];
    if (!table) return [];
    const vec = `[${args.embedding.join(',')}]`;
    // Raw SQL: cosine distance (1 - cos similarity). LIMIT KNN_TOP_K.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; name: string; statement: string | null; scope: string | null }>
    >(
      `SELECT "id", "name",
              ${args.table === 'regulation' ? '"statement"' : args.table === 'process' ? '"description" AS "statement"' : '"contentMd" AS "statement"'},
              ${args.table === 'policy' ? 'NULL::text AS "scope"' : '"scope"'}
       FROM ${table}
       WHERE "tenantId" = $1
         AND "embedding" IS NOT NULL
       ORDER BY "embedding" <=> $2::vector
       LIMIT ${Specialist31Service.KNN_TOP_K}`,
      args.tenantId,
      vec,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      statement: r.statement ?? '',
      scope: r.scope ?? null,
    }));
  }

  private async knnByNameLike(args: {
    tenantId: string;
    table: 'regulation' | 'process' | 'policy';
    nameQuery: string;
  }): Promise<KnnCandidate[]> {
    // Fallback: первые 2-3 слова запроса как ILIKE.
    const firstWords = args.nameQuery
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .slice(0, 2)
      .join(' ');
    if (!firstWords) return [];
    const pattern = `%${firstWords}%`;
    if (args.table === 'regulation') {
      const rows = await this.prisma.regulation.findMany({
        where: {
          tenantId: args.tenantId,
          name: { contains: firstWords, mode: 'insensitive' },
        },
        select: { id: true, name: true, statement: true, scope: true, contentMd: true },
        take: Specialist31Service.KNN_TOP_K,
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        statement: r.statement ?? r.contentMd ?? '',
        scope: r.scope ?? null,
      }));
    }
    if (args.table === 'process') {
      const rows = await this.prisma.process.findMany({
        where: {
          tenantId: args.tenantId,
          name: { contains: firstWords, mode: 'insensitive' },
        },
        select: { id: true, name: true, description: true, scope: true },
        take: Specialist31Service.KNN_TOP_K,
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        statement: r.description ?? '',
        scope: r.scope ?? null,
      }));
    }
    const rows = await this.prisma.policy.findMany({
      where: {
        tenantId: args.tenantId,
        name: { contains: firstWords, mode: 'insensitive' },
      },
      select: { id: true, name: true, contentMd: true, scope: true },
      take: Specialist31Service.KNN_TOP_K,
    });
    // Используем pattern для type-safety только; запрос выше уже идёт через contains.
    void pattern;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      statement: r.contentMd ?? '',
      scope: r.scope ?? null,
    }));
  }

  private async dedupeArbiter(args: {
    tenantId: string;
    draft: RegulationDraft;
    candidates: KnnCandidate[];
    dataClass: 'public' | 'internal' | 'sensitive' | 'private';
    blockId: string;
  }): Promise<DedupeVerdict> {
    if (args.candidates.length === 0) {
      return { decision: 'new', targetId: null, reasoning: 'нет кандидатов' };
    }

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (draft + кандидаты) в маркеры.
    const guardOnDedupe = this.isPromptInjectionGuardEnabled();
    const rawUserDedupe = REGULATION_DEDUPE_USER_TEMPLATE({
      draft: {
        kind: args.draft.kind,
        name: args.draft.name,
        statement: args.draft.statement,
        scope: args.draft.scope ?? null,
      },
      candidates: args.candidates,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'regulation-dedupe',
        systemPrompt: guardOnDedupe
          ? withInjectionGuard(REGULATION_DEDUPE_SYSTEM_PROMPT)
          : REGULATION_DEDUPE_SYSTEM_PROMPT,
        userMessage: guardOnDedupe ? wrapUserData(rawUserDedupe) : rawUserDedupe,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: REGULATION_DEDUPE_SCHEMA_NAME,
          schema: REGULATION_DEDUPE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: args.blockId },
        dataClass: args.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'regulation',
        reason: 'arbiter_skip',
      });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.dedupeArbiter: LLM упал — fallback к decision="new"',
      );
      return { decision: 'new', targetId: null, reasoning: 'arbiter_skipped' };
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'regulation',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let verdict: DedupeVerdict;
    try {
      verdict = JSON.parse(result.text) as DedupeVerdict;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'regulation',
        reason: 'arbiter_json_parse',
      });
      return { decision: 'new', targetId: null, reasoning: 'arbiter_parse_failed' };
    }

    // Sanity: target должен принадлежать candidates.
    const candidateIds = new Set(args.candidates.map((c) => c.id));
    if (
      verdict.decision !== 'new' &&
      verdict.targetId &&
      !candidateIds.has(verdict.targetId)
    ) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          targetId: verdict.targetId,
          candidateIds: [...candidateIds],
        },
        'specialist-3-1.dedupeArbiter: targetId не в candidates — fallback к "new"',
      );
      return {
        decision: 'new',
        targetId: null,
        reasoning: 'targetId_not_in_candidates',
      };
    }

    return verdict;
  }

  private async triageProposed(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    confidence: number;
    proposedPayload: Record<string, unknown>;
    conflictSignal: 'none' | 'soft' | 'hard';
    dataClass: 'public' | 'internal' | 'sensitive' | 'private';
    /** W4.1 shadow-compare — id блока-источника + его DataClass. */
    sourceBlockId?: string;
  }): Promise<void> {
    // W4.1 — shadow-вызов DataClassPolicyService. РЯДОМ с legacy, без
    // изменения реального write — реально пишется args.dataClass (legacy).
    if (this.dataClassPolicy && args.sourceBlockId) {
      const proposed = this.dataClassPolicy.derive({
        sources: [
          {
            dataClass: args.dataClass,
            sourceId: args.sourceBlockId,
            sourceKind: 'idea_block',
          },
        ],
        context: { kind: args.resourceType },
      }).dataClass;
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: args.dataClass,
        proposedResult: proposed,
        kind: args.resourceType,
        sourceIds: [args.sourceBlockId],
      });
    }

    try {
      await this.curation.triage({
        tenantId: args.tenantId,
        resourceType: args.resourceType,
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
          resourceType: args.resourceType,
          resourceId: args.resourceId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.triage: упал — карточка осталась без CurationItem',
      );
    }
  }

  private async reportContradiction(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    existingId: string;
    draftId: string;
    draftName: string;
    oldStatement: string;
    newStatement: string;
    blockId: string;
  }): Promise<void> {
    if (args.existingId === args.draftId) {
      // Это `merge` поверх той же записи — ConflictService.report требует
      // existingId !== newId. Виртуально различаем через суффикс :next.
      try {
        await this.conflicts.report({
          tenantId: args.tenantId,
          resourceType: args.resourceType,
          existingId: args.existingId,
          newId: `${args.draftId}:next`,
          relationType: 'contradicts',
          detectedBy: 'specialist',
          evidence: {
            specialistName: Specialist31Service.SPECIALIST_NAME,
            draftName: args.draftName,
            oldStatement: args.oldStatement.slice(0, 1_000),
            newStatement: args.newStatement.slice(0, 1_000),
            sourceBlockIds: [args.blockId],
          },
        });
        this.metrics.incCoreSpecialistConflictEvent({
          type: args.resourceType,
        });
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'specialist-3-1.reportContradiction (self): пропускаю',
        );
      }
      return;
    }
    try {
      await this.conflicts.report({
        tenantId: args.tenantId,
        resourceType: args.resourceType,
        existingId: args.existingId,
        newId: args.draftId,
        relationType: 'contradicts',
        detectedBy: 'specialist',
        evidence: {
          specialistName: Specialist31Service.SPECIALIST_NAME,
          draftName: args.draftName,
          oldStatement: args.oldStatement.slice(0, 1_000),
          newStatement: args.newStatement.slice(0, 1_000),
          sourceBlockIds: [args.blockId],
        },
      });
      this.metrics.incCoreSpecialistConflictEvent({ type: args.resourceType });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.reportContradiction: упал — пропускаю',
      );
    }
  }

  private async resolveOwnerPersonHint(
    tenantId: string,
    hint: string | null | undefined,
  ): Promise<string | null> {
    if (!hint) return null;
    const trimmed = hint.trim();
    if (trimmed.length < 2) return null;
    // Эвристика: name-like match через ILIKE по Person.name (top-1).
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        name: { contains: trimmed, mode: 'insensitive' },
      },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  private async resolvePersonSubjects(blockId: string): Promise<string[]> {
    // Person'ы, упомянутые в блоке как entity{type=person} → Person.entityId.
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

  private async upsertSingleProcessStep(args: {
    tenantId: string;
    processId: string;
    hint: NonNullable<RegulationDraft['processStepHint']>;
  }): Promise<void> {
    try {
      // Определяем order: если hint.stepOrder задан — используем его, иначе
      // last + 1.
      let order = args.hint.stepOrder ?? 0;
      if (order <= 0) {
        const last = await this.prisma.processStep.findFirst({
          where: { processId: args.processId },
          orderBy: { order: 'desc' },
          select: { order: true },
        });
        order = (last?.order ?? 0) + 1;
      }
      // unique constraint: (processId, order). Если занят — апдейт.
      const existing = await this.prisma.processStep.findUnique({
        where: { processId_order: { processId: args.processId, order } },
        select: { id: true },
      });
      if (existing) {
        await this.prisma.processStep.update({
          where: { id: existing.id },
          data: {
            name: args.hint.stepName,
            description: args.hint.stepDescription ?? undefined,
          },
        });
      } else {
        await this.prisma.processStep.create({
          data: {
            tenantId: args.tenantId,
            processId: args.processId,
            name: args.hint.stepName,
            order,
            description: args.hint.stepDescription ?? null,
          },
        });
      }
    } catch (err) {
      this.logger.debug(
        {
          processId: args.processId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.upsertSingleProcessStep: skip (best-effort)',
      );
    }
  }

  private async tryWriteEmbedding(args: {
    table: 'regulation' | 'process' | 'policy';
    id: string;
    text: string;
  }): Promise<void> {
    try {
      const text = args.text.trim().slice(0, 2_000);
      if (!text) return;
      const vec = await this.embedder.embedQuery(text);
      if (!vec) return;
      const tableMap: Record<string, string> = {
        regulation: '"regulations"',
        process: '"processes"',
        policy: '"policies"',
      };
      const table = tableMap[args.table];
      if (!table) return;
      const vecStr = `[${vec.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE ${table} SET "embedding" = $1::vector WHERE "id" = $2`,
        vecStr,
        args.id,
      );
    } catch (err) {
      // Best-effort: embedding не критичен для триажа.
      this.logger.debug(
        {
          table: args.table,
          id: args.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.tryWriteEmbedding: пропускаю (best-effort)',
      );
    }
  }

  private union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
  }

  /**
   * W4.1/W4.2 helper — резолвит финальный `dataClass` + Json-audit для
   * persist'а Regulation/Process/Policy.
   *
   * Возвращает кортеж `{ dataClass, dataClassAudit }`:
   *   - на `enforcement === 'enforce'` — derive().dataClass + serialized audit.
   *   - иначе — legacy `block.dataClass`, audit = JsonNull (NULL в БД).
   *
   * compareWithLegacy дёргается всегда при наличии сервиса — это даёт
   * shadow-метрику расхождения даже после переключения в enforce.
   */
  private deriveDataClassForPersist(args: {
    blockId: string;
    blockDataClass: DataClass;
    kind: 'regulation' | 'process' | 'policy';
  }): {
    dataClass: DataClass;
    dataClassAudit: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  } {
    const enforcement = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const proposed = this.dataClassPolicy?.derive({
      sources: [
        {
          dataClass: args.blockDataClass,
          sourceId: args.blockId,
          sourceKind: 'idea_block',
        },
      ],
      context: { kind: args.kind },
    });
    if (this.dataClassPolicy && proposed) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: args.blockDataClass,
        proposedResult: proposed.dataClass,
        kind: args.kind,
        sourceIds: [args.blockId],
      });
    }
    const finalDc =
      enforcement === 'enforce' && proposed
        ? proposed.dataClass
        : args.blockDataClass;
    const audit: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      enforcement === 'enforce' && proposed
        ? (proposed.audit as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    return { dataClass: finalDc, dataClassAudit: audit };
  }
}

// ──────────────────────── shared types ────────────────────────

export interface RegulationDraft {
  kind: 'regulation' | 'process' | 'policy' | 'standard';
  name: string;
  statement: string;
  scope?: string | null;
  ownerHint?: string | null;
  severity?:
    | 'advisory'
    | 'mandatory'
    | 'blocking'
    | 'critical'
    | 'recommended'
    | 'standard'
    | null;
  category?: 'regulation' | 'standard' | null;
  processStepHint?: {
    processName: string;
    stepName: string;
    stepOrder?: number | null;
    stepDescription?: string | null;
  } | null;
  confidence: number;
}

interface KnnCandidate {
  id: string;
  name: string;
  statement: string;
  scope: string | null;
}

interface DedupeVerdict {
  decision: 'new' | 'merge' | 'extension' | 'contradicts';
  targetId: string | null;
  reasoning: string;
}

// Prisma `_namespace` — отметка, что мы используем Prisma transactional types
// внутри (пока ничего из Prisma не нужно как value, но JSON-валидация Prisma
// будет нужна для proposedPayload приведения).
void Prisma;
