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

import type { OrgDocumentKind } from '../prompts/structured-document-compiler.prompt';

import { DataClassPolicyService } from './dataclass-policy.service';
import { KnowledgeEmbeddingService } from './embedding.service';
import { Specialist31ProbeService } from './specialist-3-1-probe.service';
import {
  type CompileResult,
  StructuredDocumentCompilerService,
} from './structured-document-compiler.service';

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
    // Волна 6 A7 — агент-компилятор contentMd орг-документа. @Optional,
    // потому что unit-тесты могут не поднимать KnowledgeCoreModule целиком.
    @Optional()
    @Inject(StructuredDocumentCompilerService)
    private readonly docCompiler?: StructuredDocumentCompilerService,
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
      // LLM решила, что блок — про process / policy / instruction. Делегируем
      // соответствующий путь. Это «misrouted» сигнал, но не failure.
      if (draft.kind === 'process') {
        await this.upsertProcess(block, draft);
        return;
      }
      if (draft.kind === 'policy') {
        await this.upsertPolicy(block, draft);
        return;
      }
      if (draft.kind === 'instruction') {
        await this.upsertInstruction(block, draft);
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
      // LLM думает иначе. Если regulation/policy/standard/instruction — делегируем.
      if (draft.kind === 'regulation' || draft.kind === 'standard') {
        await this.upsertRegulation(block, draft);
        return;
      }
      if (draft.kind === 'policy') {
        await this.upsertPolicy(block, draft);
        return;
      }
      if (draft.kind === 'instruction') {
        await this.upsertInstruction(block, draft);
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
      if (draft.kind === 'instruction') {
        await this.upsertInstruction(block, draft);
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
    // A1.2 (ТЗ 2026-06-11) — анти-плодёж гейт «это норма КОМПАНИИ?». Фрагменты
    // с isOrgNorm=false (чужая практика / гипотетика / разовое поручение / голое
    // упоминание) НЕ создают карточку-документ. Исключение — заявленная
    // потребность (extractionStatus нужен/обсуждается): её сохраняем (recall —
    // реальных регламентов меньше и они важнее). За kill-switch
    // regulationGateStrict (default ON); OFF → старое поведение «создавать всегда».
    let gateStrict: boolean;
    try {
      gateStrict = this.cfg?.aiFeatures.regulationGateStrict !== false;
    } catch {
      gateStrict = true;
    }
    const isDeclaredNeed =
      parsed.extractionStatus === 'нужен' || parsed.extractionStatus === 'обсуждается';
    if (gateStrict && parsed.isOrgNorm === false && !isDeclaredNeed) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: 'regulation',
        reason: 'not_a_norm',
      });
      this.logger.debug(
        { blockId: block.id, kind: parsed.kind, name: parsed.name },
        'specialist-3-1.extractDraft: isOrgNorm=false — не действующая норма компании, skip',
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
        // Ф1 (форматтер на создании) — структурный contentMd компилятором уже
        // на ПЕРВОЙ версии (режим СОЗДАНИЕ: existingContentMd=''). На fallback
        // (null: kill-switch OFF / ошибка LLM / пустой) — legacy: сырой statement.
        const compiled = await this.tryCompileContent({
          kind: 'regulation',
          tenantId: block.tenantId,
          name: draft.name,
          existingContentMd: '',
          newStatement: draft.statement,
          block,
        });
        const bodyMd = compiled?.contentMd ?? draft.statement;
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
            // contentMd обновляем ТОЛЬКО при успешной компиляции (на name-collision
            // не затираем структурное тело сырым statement — legacy не трогал contentMd).
            ...(compiled ? { contentMd: bodyMd } : {}),
          },
          create: {
            tenantId: block.tenantId,
            name: draft.name,
            contentMd: bodyMd,
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
        // Ф1 — на успешной компиляции фиксируем v1-снимок CardVersion одной
        // транзакцией (зеркало merge-ветки :470). nextCardVersion→1 у новой карточки.
        if (compiled) {
          const persisted = regulation;
          const newVersion = await this.nextCardVersion(
            block.tenantId,
            'regulation',
            persisted.id,
          );
          regulation = await this.prisma.$transaction(async (tx) => {
            const cv = await tx.cardVersion.create({
              data: {
                tenantId: block.tenantId,
                resourceType: 'regulation',
                resourceId: persisted.id,
                version: newVersion,
                payload: {
                  contentMd: compiled.contentMd,
                  steps: compiled.steps,
                  signals: compiled.signals,
                  changeReasonText: compiled.changeReason,
                } as unknown as Prisma.InputJsonValue,
                changeReason: 'create',
                trustTier: 'auto',
                previousVersionId: persisted.currentVersionId,
                createdByUserId: null,
              },
            });
            return tx.regulation.update({
              where: { id: persisted.id },
              data: { currentVersionId: cv.id, version: newVersion },
            });
          });
        }
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
          // Волна 6 A7 — на merge/extension собираем структурный contentMd
          // компилятором (ДОПОЛНЕНИЕ к existing.contentMd), не теряя старое.
          // На fallback (null) — contentMd остаётся прежним (legacy-поведение).
          const compiled =
            verdict.decision === 'merge' || verdict.decision === 'extension'
              ? await this.tryCompileContent({
                  kind: 'regulation',
                  tenantId: block.tenantId,
                  name: existing.name,
                  existingContentMd: existing.contentMd,
                  newStatement: draft.statement,
                  block,
                })
              : null;
          if (compiled) {
            // A3.2 — фиксируем новую версию contentMd снимком в CardVersion
            // (история ревизий орг-документа) в одной транзакции с update'ом.
            const newVersion = (existing.version ?? 1) + 1;
            regulation = await this.prisma.$transaction(async (tx) => {
              const cv = await tx.cardVersion.create({
                data: {
                  tenantId: block.tenantId,
                  resourceType: 'regulation',
                  resourceId: existing.id,
                  version: newVersion,
                  payload: {
                    contentMd: compiled.contentMd,
                    steps: compiled.steps,
                    signals: compiled.signals,
                    changeReasonText: compiled.changeReason,
                  } as unknown as Prisma.InputJsonValue,
                  changeReason:
                    verdict.decision === 'merge' ? 'merge' : 'extension',
                  trustTier: 'auto',
                  previousVersionId: existing.currentVersionId,
                  createdByUserId: null,
                },
              });
              return tx.regulation.update({
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
                    set: this.union(
                      personSubjectIds,
                      existing.personSubjectIds,
                    ),
                  },
                  confidence: draft.confidence ?? existing.confidence,
                  contentMd: compiled.contentMd,
                  version: newVersion,
                  currentVersionId: cv.id,
                },
              });
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
          }
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
        // Ф1 — структурное описание процесса компилятором на создании (режим
        // СОЗДАНИЕ). Тело процесса хранится в Process.description. fallback → statement.
        const compiled = await this.tryCompileContent({
          kind: 'process',
          tenantId: block.tenantId,
          name: processName,
          existingContentMd: '',
          newStatement: draft.statement,
          block,
        });
        const bodyMd = compiled?.contentMd ?? draft.statement;
        proc = await this.prisma.process.upsert({
          where: {
            tenantId_name: { tenantId: block.tenantId, name: processName },
          },
          update: {
            description: bodyMd,
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
            description: bodyMd,
            scope: draft.scope ?? null,
            ownerPersonId: ownerPersonId ?? null,
            sourceBlockIds,
            personSubjectIds,
            dataClass: dcResProc.dataClass,
            dataClassAudit: dcResProc.dataClassAudit,
            confidence: draft.confidence ?? null,
          },
        });
        // Ф1 — v1-снимок CardVersion (process: версия через nextCardVersion,
        // финальный update ставит только currentVersionId — у Process нет version).
        if (compiled) {
          const persisted = proc;
          const newVersion = await this.nextCardVersion(
            block.tenantId,
            'process',
            persisted.id,
          );
          proc = await this.prisma.$transaction(async (tx) => {
            const cv = await tx.cardVersion.create({
              data: {
                tenantId: block.tenantId,
                resourceType: 'process',
                resourceId: persisted.id,
                version: newVersion,
                payload: {
                  contentMd: compiled.contentMd,
                  steps: compiled.steps,
                  signals: compiled.signals,
                  changeReasonText: compiled.changeReason,
                } as unknown as Prisma.InputJsonValue,
                changeReason: 'create',
                trustTier: 'auto',
                previousVersionId: persisted.currentVersionId,
                createdByUserId: null,
              },
            });
            return tx.process.update({
              where: { id: persisted.id },
              data: { currentVersionId: cv.id },
            });
          });
        }
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
          // Волна 6 A7 — на merge/extension собираем структурное описание
          // процесса компилятором (тело хранится в Process.description).
          // На fallback (null) — legacy: оставляем существующее описание.
          // NB: синхронизация steps[] из вывода компилятора с таблицей
          //     ProcessStep — следующая волна (сейчас шаги пишутся отдельным
          //     single-step upsert'ом из processStepHint).
          const compiled =
            verdict.decision === 'merge' || verdict.decision === 'extension'
              ? await this.tryCompileContent({
                  kind: 'process',
                  tenantId: block.tenantId,
                  name: existing.name,
                  existingContentMd: existing.description,
                  newStatement: draft.statement,
                  block,
                })
              : null;
          if (compiled) {
            // A3.2 — снимок новой версии описания процесса в CardVersion
            // (тело процесса хранится в Process.description) одной транзакцией.
            // NB: у Process нет колонки `version` (только currentVersionId),
            // поэтому номер версии берём из последнего снимка CardVersion.
            const newVersion = (await this.nextCardVersion(
              block.tenantId,
              'process',
              existing.id,
            ));
            proc = await this.prisma.$transaction(async (tx) => {
              const cv = await tx.cardVersion.create({
                data: {
                  tenantId: block.tenantId,
                  resourceType: 'process',
                  resourceId: existing.id,
                  version: newVersion,
                  payload: {
                    contentMd: compiled.contentMd,
                    steps: compiled.steps,
                    signals: compiled.signals,
                    changeReasonText: compiled.changeReason,
                  } as unknown as Prisma.InputJsonValue,
                  changeReason:
                    verdict.decision === 'merge' ? 'merge' : 'extension',
                  trustTier: 'auto',
                  previousVersionId: existing.currentVersionId,
                  createdByUserId: null,
                },
              });
              return tx.process.update({
                where: { id: existing.id },
                data: {
                  scope: draft.scope ?? existing.scope ?? undefined,
                  ownerPersonId:
                    ownerPersonId ?? existing.ownerPersonId ?? undefined,
                  sourceBlockIds: {
                    set: this.union(sourceBlockIds, existing.sourceBlockIds),
                  },
                  personSubjectIds: {
                    set: this.union(
                      personSubjectIds,
                      existing.personSubjectIds,
                    ),
                  },
                  confidence: draft.confidence ?? existing.confidence,
                  description: compiled.contentMd,
                  currentVersionId: cv.id,
                },
              });
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
          }
          // A3.3 — недеструктивная синхронизация ProcessStep из steps[]
          // компилятора (best-effort, вне транзакции версии; ничего не удаляем).
          if (compiled && compiled.steps.length > 0) {
            await this.reconcileProcessSteps({
              tenantId: block.tenantId,
              processId: proc.id,
              steps: compiled.steps,
            });
          }
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
      // На α-7 — простой single-step upsert (отдельный pass полного извлечения
      // шагов процесса не реализован — промпт-сирота process-steps-extract
      // удалён 2026-06-10 как нереализованный).
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
        // Ф1 — структурный contentMd политики компилятором на создании. fallback → statement.
        const compiled = await this.tryCompileContent({
          kind: 'policy',
          tenantId: block.tenantId,
          name: draft.name,
          existingContentMd: '',
          newStatement: draft.statement,
          block,
        });
        const bodyMd = compiled?.contentMd ?? draft.statement;
        policy = await this.prisma.policy.upsert({
          where: {
            tenantId_name: { tenantId: block.tenantId, name: draft.name },
          },
          update: {
            contentMd: bodyMd,
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
            contentMd: bodyMd,
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
        // Ф1 — v1-снимок CardVersion (policy: версия через nextCardVersion,
        // финальный update ставит только currentVersionId — у Policy нет version).
        if (compiled) {
          const persisted = policy;
          const newVersion = await this.nextCardVersion(
            block.tenantId,
            'policy',
            persisted.id,
          );
          policy = await this.prisma.$transaction(async (tx) => {
            const cv = await tx.cardVersion.create({
              data: {
                tenantId: block.tenantId,
                resourceType: 'policy',
                resourceId: persisted.id,
                version: newVersion,
                payload: {
                  contentMd: compiled.contentMd,
                  steps: compiled.steps,
                  signals: compiled.signals,
                  changeReasonText: compiled.changeReason,
                } as unknown as Prisma.InputJsonValue,
                changeReason: 'create',
                trustTier: 'auto',
                previousVersionId: persisted.currentVersionId,
                createdByUserId: null,
              },
            });
            return tx.policy.update({
              where: { id: persisted.id },
              data: { currentVersionId: cv.id },
            });
          });
        }
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
          // Волна 6 A7 — на merge/extension собираем структурный contentMd
          // политики компилятором (ДОПОЛНЕНИЕ к existing.contentMd). На
          // fallback (null) — legacy: contentMd = draft.statement.
          const compiled =
            verdict.decision === 'merge' || verdict.decision === 'extension'
              ? await this.tryCompileContent({
                  kind: 'policy',
                  tenantId: block.tenantId,
                  name: existing.name,
                  existingContentMd: existing.contentMd,
                  newStatement: draft.statement,
                  block,
                })
              : null;
          if (compiled) {
            // A3.2 — снимок новой версии contentMd политики в CardVersion.
            // NB: у Policy нет колонки `version` (только currentVersionId),
            // поэтому номер версии берём из последнего снимка CardVersion.
            const newVersion = (await this.nextCardVersion(
              block.tenantId,
              'policy',
              existing.id,
            ));
            policy = await this.prisma.$transaction(async (tx) => {
              const cv = await tx.cardVersion.create({
                data: {
                  tenantId: block.tenantId,
                  resourceType: 'policy',
                  resourceId: existing.id,
                  version: newVersion,
                  payload: {
                    contentMd: compiled.contentMd,
                    steps: compiled.steps,
                    signals: compiled.signals,
                    changeReasonText: compiled.changeReason,
                  } as unknown as Prisma.InputJsonValue,
                  changeReason:
                    verdict.decision === 'merge' ? 'merge' : 'extension',
                  trustTier: 'auto',
                  previousVersionId: existing.currentVersionId,
                  createdByUserId: null,
                },
              });
              return tx.policy.update({
                where: { id: existing.id },
                data: {
                  severity: severity ?? existing.severity,
                  scope: draft.scope ?? existing.scope ?? undefined,
                  ownerPersonId:
                    ownerPersonId ?? existing.ownerPersonId ?? undefined,
                  sourceBlockIds: {
                    set: this.union(sourceBlockIds, existing.sourceBlockIds),
                  },
                  personSubjectIds: {
                    set: this.union(
                      personSubjectIds,
                      existing.personSubjectIds,
                    ),
                  },
                  confidence: draft.confidence ?? existing.confidence,
                  contentMd: compiled.contentMd,
                  currentVersionId: cv.id,
                },
              });
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
          }
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

  /**
   * A12 (Волна 6) — upsert инструкции (kind='instruction') в ОТДЕЛЬНУЮ таблицу
   * `instructions` (НЕ regulations). Инструкция — пошаговое «как сделать X» для
   * ОДНОЙ роли (single-role). Зеркалит upsertProcess по структуре, но проще:
   * без KNN-дедуп-арбитра и без curation-triage (Instruction не входит в
   * RBAC resourceType триажа regulation/process/policy — версии/триаж
   * инструкций добавятся следующей волной). Upsert идемпотентен по
   * (tenantId, name).
   *
   * Маппинг A12-полей:
   *   - extractionStatus → status (ProcessStatus): «существует» → active;
   *     «нужен»/«обсуждается» → deprecated (ближайший не-active статус в enum
   *     ProcessStatus, у которого нет 'draft'/'proposed' — deprecated означает
   *     «ещё/уже не действующий»).
   *   - roles[0] (или scope 'role:<id>') → forRole.
   *   - roles → personSubjectIds НЕ кладём (roles — это должности, не Person'ы);
   *     personSubjectIds резолвятся из упомянутых в блоке Person-entity, как у
   *     остальных типов.
   */
  private async upsertInstruction(
    block: IdeaBlock,
    draft: RegulationDraft,
  ): Promise<void> {
    try {
      const ownerPersonId = await this.resolveOwnerPersonHint(
        block.tenantId,
        draft.ownerHint,
      );
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);
      const dcRes = this.deriveDataClassForPersist({
        blockId: block.id,
        blockDataClass: block.dataClass,
        kind: 'process',
      });

      const forRole = this.deriveForRole(draft);
      const status = this.mapExtractionStatusToProcessStatus(
        draft.extractionStatus,
      );

      // Ф1 — компилятор для instruction (раньше НЕ вызывался вообще). Режим
      // СОЗДАНИЕ; fallback (null) → legacy сырой statement.
      const compiled = await this.tryCompileContent({
        kind: 'instruction',
        tenantId: block.tenantId,
        name: draft.name,
        existingContentMd: '',
        newStatement: draft.statement,
        block,
      });
      const bodyMd = compiled?.contentMd ?? draft.statement;
      let instruction = await this.prisma.instruction.upsert({
        where: {
          tenantId_name: { tenantId: block.tenantId, name: draft.name },
        },
        update: {
          contentMd: bodyMd,
          statement: draft.statement,
          scope: draft.scope ?? undefined,
          forRole: forRole ?? undefined,
          status,
          ownerPersonId: ownerPersonId ?? undefined,
          sourceBlockIds: { set: this.union(sourceBlockIds, []) },
          personSubjectIds: { set: this.union(personSubjectIds, []) },
          dataClass: dcRes.dataClass,
          dataClassAudit: dcRes.dataClassAudit,
          confidence: draft.confidence ?? null,
        },
        create: {
          tenantId: block.tenantId,
          name: draft.name,
          contentMd: bodyMd,
          statement: draft.statement,
          scope: draft.scope ?? null,
          forRole: forRole ?? null,
          status,
          ownerPersonId: ownerPersonId ?? null,
          sourceBlockIds,
          personSubjectIds,
          dataClass: dcRes.dataClass,
          dataClassAudit: dcRes.dataClassAudit,
          confidence: draft.confidence ?? null,
        },
      });
      // Ф1 — v1-снимок CardVersion (instruction имеет version + currentVersionId,
      // как regulation).
      if (compiled) {
        const persisted = instruction;
        const newVersion = await this.nextCardVersion(
          block.tenantId,
          'instruction',
          persisted.id,
        );
        instruction = await this.prisma.$transaction(async (tx) => {
          const cv = await tx.cardVersion.create({
            data: {
              tenantId: block.tenantId,
              resourceType: 'instruction',
              resourceId: persisted.id,
              version: newVersion,
              payload: {
                contentMd: compiled.contentMd,
                steps: compiled.steps,
                signals: compiled.signals,
                changeReasonText: compiled.changeReason,
              } as unknown as Prisma.InputJsonValue,
              changeReason: 'create',
              trustTier: 'auto',
              previousVersionId: persisted.currentVersionId,
              createdByUserId: null,
            },
          });
          return tx.instruction.update({
            where: { id: persisted.id },
            data: { currentVersionId: cv.id, version: newVersion },
          });
        });
      }

      // Эмбеддинг (best-effort) — для будущего KNN-дедупа инструкций.
      await this.tryWriteInstructionEmbedding({
        id: instruction.id,
        text: `${draft.name} ${draft.statement}`,
      });
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
        'specialist-3-1.upsertInstruction: внутренняя ошибка — пропускаю блок',
      );
    }
  }

  /**
   * A12 — выбор forRole для инструкции: из scope вида 'role:<id>' (приоритет),
   * иначе первая роль из draft.roles. Возвращает строку ≤120 символов (лимит
   * Instruction.forRole в схеме) или null.
   */
  private deriveForRole(draft: RegulationDraft): string | null {
    const scope = draft.scope?.trim();
    if (scope && scope.startsWith('role:')) {
      const id = scope.slice('role:'.length).trim();
      if (id) return id.slice(0, 120);
    }
    const first = draft.roles?.find((r) => r && r.trim().length > 0)?.trim();
    return first ? first.slice(0, 120) : null;
  }

  /**
   * A12 — маппинг extractionStatus (русские ярлыки LLM) → ProcessStatus:
   *   «существует» → active; «нужен»/«обсуждается» → deprecated; null → active.
   */
  private mapExtractionStatusToProcessStatus(
    s: RegulationDraft['extractionStatus'],
  ): 'active' | 'deprecated' {
    return s === 'нужен' || s === 'обсуждается' ? 'deprecated' : 'active';
  }

  /**
   * A12 — embedding для Instruction (best-effort). Отдельный метод, т.к.
   * tableMap в tryWriteEmbedding покрывает только regulation/process/policy.
   */
  private async tryWriteInstructionEmbedding(args: {
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
        `UPDATE "instructions" SET "embedding" = $1::vector WHERE "id" = $2`,
        vecStr,
        args.id,
      );
    } catch (err) {
      this.logger.debug(
        {
          id: args.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.tryWriteInstructionEmbedding: пропускаю (best-effort)',
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

  /**
   * A3.2 — следующий номер версии для CardVersion-снимка ресурса, у которого
   * на самой карточке нет колонки `version` (Process/Policy: только
   * currentVersionId). Берём max(version) последнего снимка + 1, иначе 1.
   * best-effort: при сбое — 1 (всё равно создастся первый снимок).
   */
  private async nextCardVersion(
    tenantId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<number> {
    try {
      const last = await this.prisma.cardVersion.findFirst({
        where: { tenantId, resourceType, resourceId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return (last?.version ?? 0) + 1;
    } catch {
      return 1;
    }
  }

  /**
   * A3.3 — недеструктивная синхронизация шагов процесса из вывода компилятора
   * (steps[]) с таблицей ProcessStep. Совпадение по нормализованному имени
   * (trim+lowercase): найден → обновляем description+order, не найден → создаём.
   * Ничего НЕ удаляем (даже если шаг пропал из компиляции — это могла быть
   * усечённая выборка блоков). best-effort: collision на @@unique([processId,
   * order]) ловим и пропускаем конкретный шаг, общий try/catch логирует в debug.
   */
  private async reconcileProcessSteps(args: {
    tenantId: string;
    processId: string;
    steps: { title: string; description: string }[];
  }): Promise<void> {
    try {
      const norm = (s: string): string => s.trim().toLowerCase();
      const existing = await this.prisma.processStep.findMany({
        where: { processId: args.processId },
        select: { id: true, name: true, order: true },
      });
      const byName = new Map<string, { id: string; order: number }>();
      for (const e of existing) {
        byName.set(norm(e.name), { id: e.id, order: e.order });
      }
      for (let i = 0; i < args.steps.length; i++) {
        const step = args.steps[i];
        if (!step) continue;
        const title = step.title.trim();
        if (!title) continue;
        const order = i + 1;
        const match = byName.get(norm(title));
        try {
          if (match) {
            await this.prisma.processStep.update({
              where: { id: match.id },
              data: { description: step.description, order },
            });
          } else {
            await this.prisma.processStep.create({
              data: {
                tenantId: args.tenantId,
                processId: args.processId,
                name: title,
                order,
                description: step.description,
              },
            });
          }
        } catch (stepErr) {
          // collision на @@unique([processId, order]) или иной локальный сбой —
          // пропускаем конкретный шаг (best-effort, без удалений).
          this.logger.debug(
            {
              processId: args.processId,
              order,
              err:
                stepErr instanceof Error ? stepErr.message : String(stepErr),
            },
            'specialist-3-1.reconcileProcessSteps: skip step (best-effort)',
          );
        }
      }
    } catch (err) {
      this.logger.debug(
        {
          processId: args.processId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.reconcileProcessSteps: skip (best-effort)',
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
   * Волна 6 A7 — собрать `contentMd` орг-документа через агент-компилятор на
   * verdict merge/extension. Возвращает готовый markdown по шаблону типа
   * (режим ДОПОЛНЕНИЕ — существующее тело + новый блок, ничего не теряя) либо
   * `null`, если компилятор отключён/недоступен/вернул fallback (тогда caller
   * остаётся на legacy plain-update поля).
   *
   * best-effort: компилятор сам не падает (внутренний try/catch + fallback);
   * здесь дополнительный guard на отсутствие сервиса / kill-switch OFF.
   */
  private async tryCompileContent(args: {
    kind: OrgDocumentKind;
    tenantId: string;
    name: string;
    existingContentMd: string | null | undefined;
    newStatement: string;
    block: IdeaBlock & { evidence?: IdeaBlockEvidence[] };
  }): Promise<CompileResult | null> {
    if (!this.docCompiler || !this.docCompiler.isEnabled()) return null;
    try {
      const quotes = (args.block.evidence ?? [])
        .slice(0, 6)
        .map((e) => e.quote)
        .filter((q): q is string => !!q && q.length > 0);
      const res = await this.docCompiler.compile(
        {
          kind: args.kind,
          name: args.name,
          newSourceBlocks: [
            {
              name: args.block.name,
              question: args.block.criticalQuestion,
              answer: args.newStatement,
              quotes,
            },
          ],
          existingContentMd: args.existingContentMd ?? '',
          nowIso: new Date().toISOString(),
        },
        {
          tenantId: args.tenantId,
          dataClass: args.block.dataClass,
          sourceRef: { type: 'idea_block', id: args.block.id },
        },
      );
      // ok=false → вернулся fallback (existingContentMd); не считаем это
      // «успешной сборкой» — пусть caller использует legacy-логику.
      return res.ok ? res : null;
    } catch (err) {
      this.logger.debug(
        {
          kind: args.kind,
          name: args.name,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-1.tryCompileContent: пропускаю (best-effort)',
      );
      return null;
    }
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
  kind: 'regulation' | 'process' | 'policy' | 'standard' | 'instruction';
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
  /**
   * A1.2 (ТЗ 2026-06-11) — флаг «это повторяемая норма КОМПАНИИ?». LLM-схема
   * `regulation-extract.prompt` уже возвращает это поле (required); здесь —
   * его TS-зеркало для анти-плодёж гейта в `extractDraft`. Контракт инструмента
   * не меняется — поле задаётся в промпте, не тут.
   */
  isOrgNorm?: boolean | null;
  /** A12 (Волна 6) — статус существования документа (русские ярлыки LLM). */
  extractionStatus?: 'существует' | 'нужен' | 'обсуждается' | null;
  /** A12 — роли/должности, которых касается норма. Для instruction — исполнитель. */
  roles?: string[];
  /** A12 — дословная опора из блока (≤15-20 слов). */
  evidenceQuote?: string | null;
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
