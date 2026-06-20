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
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import { buildVectorLiteral } from '../../embeddings/services/vector-literal.util';
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

@Injectable()
export class Specialist31Service {
  private readonly logger = new Logger(Specialist31Service.name);

  static readonly SPECIALIST_NAME = '3-1-regulations';
  private static readonly KNN_TOP_K = 5;
  private static readonly DEDUPE_ARBITER_MAX_TOKENS = 2500;
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
    @Optional()
    @Inject(StructuredDocumentCompilerService)
    private readonly docCompiler?: StructuredDocumentCompilerService,
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async processRegulationBlock(
    block: IdeaBlock & {
      evidence: IdeaBlockEvidence[];
      entities: IdeaBlockEntity[];
    },
  ): Promise<void> {
    const draft = await this.extractDraft(block);
    if (!draft) return;
    if (draft.kind !== 'regulation' && draft.kind !== 'standard') {
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

  async processProcessStepBlock(
    block: IdeaBlock & {
      evidence: IdeaBlockEvidence[];
      entities: IdeaBlockEntity[];
    },
  ): Promise<void> {
    const draft = await this.extractDraft(block);
    if (!draft) return;
    if (draft.kind !== 'process') {
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

    const ownerCompanyPrior = await this.resolveOwnerCompanyPrior(block.id);
    const meetingExternalLikely = await this.resolveMeetingExternalLikely(block.id);

    const guardOnExtract = this.isPromptInjectionGuardEnabled();
    const rawUserExtract = REGULATION_EXTRACT_USER_TEMPLATE({
      blockName: block.name,
      criticalQuestion: block.criticalQuestion,
      trustedAnswer: block.trustedAnswer,
      signalType: block.signalType,
      tags: block.tags,
      evidenceQuotes: quotes,
      ownerCompanyPrior,
      meetingExternalLikely,
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
        maxTokens: 4096,
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
    if (ownerCompanyPrior === 'клиент' || (parsed.ownerCompany && parsed.ownerCompany !== 'наша')) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: 'regulation',
        reason: 'not_our_org',
      });
      return null;
    }
    if (parsed.isKeepableOrgNorm === false) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: 'regulation',
        reason: 'not_keepable',
      });
      return null;
    }
    const minMaterializeConfidence = (() => {
      try {
        return this.cfg?.aiFeatures.regulationMinMaterializeConfidence ?? 0.6;
      } catch {
        return 0.6;
      }
    })();
    if ((parsed.confidence ?? 0) < minMaterializeConfidence) {
      this.logger.debug(
        { blockId: block.id, confidence: parsed.confidence },
        'specialist-3-1.extractDraft: confidence слишком низкий — skip',
      );
      return null;
    }
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

  private async upsertRegulation(block: IdeaBlock, draft: RegulationDraft): Promise<void> {
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

      const ownerPersonId = await this.resolveOwnerPersonHint(block.tenantId, draft.ownerHint);
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
        const existing = await this.prisma.regulation.findUnique({
          where: { id: verdict.targetId },
        });
        if (!existing) {
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
                  changeReason: verdict.decision === 'merge' ? 'merge' : 'extension',
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
                  ownerPersonId: ownerPersonId ?? existing.ownerPersonId ?? undefined,
                  sourceBlockIds: {
                    set: this.union(sourceBlockIds, existing.sourceBlockIds),
                  },
                  personSubjectIds: {
                    set: this.union(personSubjectIds, existing.personSubjectIds),
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
                ownerPersonId: ownerPersonId ?? existing.ownerPersonId ?? undefined,
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

      await this.tryWriteEmbedding({
        table: 'regulation',
        id: regulation.id,
        text: `${draft.name} ${draft.statement}`,
      });

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

  private async upsertProcess(block: IdeaBlock, draft: RegulationDraft): Promise<void> {
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

      const ownerPersonId = await this.resolveOwnerPersonHint(block.tenantId, draft.ownerHint);
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      let proc: Process;

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
            const newVersion = await this.nextCardVersion(block.tenantId, 'process', existing.id);
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
                  changeReason: verdict.decision === 'merge' ? 'merge' : 'extension',
                  trustTier: 'auto',
                  previousVersionId: existing.currentVersionId,
                  createdByUserId: null,
                },
              });
              return tx.process.update({
                where: { id: existing.id },
                data: {
                  scope: draft.scope ?? existing.scope ?? undefined,
                  ownerPersonId: ownerPersonId ?? existing.ownerPersonId ?? undefined,
                  sourceBlockIds: {
                    set: this.union(sourceBlockIds, existing.sourceBlockIds),
                  },
                  personSubjectIds: {
                    set: this.union(personSubjectIds, existing.personSubjectIds),
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
                ownerPersonId: ownerPersonId ?? existing.ownerPersonId ?? undefined,
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

  private async upsertPolicy(block: IdeaBlock, draft: RegulationDraft): Promise<void> {
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

      const ownerPersonId = await this.resolveOwnerPersonHint(block.tenantId, draft.ownerHint);
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      const severityMap: Record<string, 'advisory' | 'mandatory' | 'blocking'> = {
        advisory: 'advisory',
        mandatory: 'mandatory',
        blocking: 'blocking',
        critical: 'blocking',
        recommended: 'advisory',
        standard: 'mandatory',
      };
      const severity = draft.severity ? (severityMap[draft.severity] ?? 'advisory') : 'advisory';

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
            const newVersion = await this.nextCardVersion(block.tenantId, 'policy', existing.id);
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
                  changeReason: verdict.decision === 'merge' ? 'merge' : 'extension',
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
                  ownerPersonId: ownerPersonId ?? existing.ownerPersonId ?? undefined,
                  sourceBlockIds: {
                    set: this.union(sourceBlockIds, existing.sourceBlockIds),
                  },
                  personSubjectIds: {
                    set: this.union(personSubjectIds, existing.personSubjectIds),
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
                ownerPersonId: ownerPersonId ?? existing.ownerPersonId ?? undefined,
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

  private async upsertInstruction(block: IdeaBlock, draft: RegulationDraft): Promise<void> {
    try {
      const ownerPersonId = await this.resolveOwnerPersonHint(block.tenantId, draft.ownerHint);
      const sourceBlockIds = [block.id];
      const personSubjectIds = await this.resolvePersonSubjects(block.id);
      const dcRes = this.deriveDataClassForPersist({
        blockId: block.id,
        blockDataClass: block.dataClass,
        kind: 'process',
      });

      const forRole = this.deriveForRole(draft);
      const status = this.mapExtractionStatusToProcessStatus(draft.extractionStatus);

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

  private deriveForRole(draft: RegulationDraft): string | null {
    const scope = draft.scope?.trim();
    if (scope && scope.startsWith('role:')) {
      const id = scope.slice('role:'.length).trim();
      if (id) return id.slice(0, 120);
    }
    const first = draft.roles?.find((r) => r && r.trim().length > 0)?.trim();
    return first ? first.slice(0, 120) : null;
  }

  private mapExtractionStatusToProcessStatus(
    s: RegulationDraft['extractionStatus'],
  ): 'active' | 'deprecated' {
    return s === 'нужен' || s === 'обсуждается' ? 'deprecated' : 'active';
  }

  private async tryWriteInstructionEmbedding(args: { id: string; text: string }): Promise<void> {
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

  private async knnCandidates(args: {
    tenantId: string;
    table: 'regulation' | 'process' | 'policy';
    nameQuery: string;
  }): Promise<KnnCandidate[]> {
    const queryText = args.nameQuery.trim().slice(0, 1_000);
    if (!queryText) return [];

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
    // Класс G2 — guard pgvector-литерала query-вектора. При reject (смена
    // модели → другая размерность; битый вектор → NaN/Infinity) возвращаем []:
    // caller (`knnCandidates`) деградирует на name-like fallback, не валя `<=>`.
    const expectedDim = this.cfg?.ai?.embeddings?.dimensions ?? 1536;
    const guard = buildVectorLiteral(args.embedding, expectedDim);
    if (guard.literal === null) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          table: args.table,
          reason: guard.rejectReason,
          actualDim: args.embedding.length,
          expectedDim,
        },
        'specialist-3-1.knnByEmbedding: query-вектор отвергнут guard-ом — name-like fallback',
      );
      return [];
    }
    const vec = guard.literal;
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

    for (let attempt = 0; attempt < 2; attempt++) {
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
          maxTokens: Specialist31Service.DEDUPE_ARBITER_MAX_TOKENS,
        });
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-1.dedupeArbiter: LLM упал — ретрай/фоллбэк',
        );
        continue;
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
        this.logger.warn(
          {
            tenantId: args.tenantId,
            attempt,
            textSample: result.text.slice(0, 300),
          },
          'specialist-3-1.dedupeArbiter: JSON.parse упал — ретрай/фоллбэк',
        );
        continue;
      }

      const candidateIds = new Set(args.candidates.map((c) => c.id));
      if (verdict.decision !== 'new' && verdict.targetId && !candidateIds.has(verdict.targetId)) {
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

    this.metrics.incCoreSpecialistExtractionFailure({
      type: 'regulation',
      reason: 'dedupe_fallback_new',
    });
    this.logger.warn(
      { tenantId: args.tenantId },
      'specialist-3-1.dedupeArbiter: невалидный ответ после ретрая — fail-open decision="new" (гарант от дублей — крон-консолидатор)',
    );
    return { decision: 'new', targetId: null, reasoning: 'dedupe_fallback_new' };
  }

  private async triageProposed(args: {
    tenantId: string;
    resourceType: 'regulation' | 'process' | 'policy';
    resourceId: string;
    confidence: number;
    proposedPayload: Record<string, unknown>;
    conflictSignal: 'none' | 'soft' | 'hard';
    dataClass: 'public' | 'internal' | 'sensitive' | 'private';
    sourceBlockId?: string;
  }): Promise<void> {
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

  private async resolveOwnerCompanyPrior(blockId: string): Promise<'клиент' | 'неизвестно'> {
    const hasEmployeeSubject = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: 'subject',
        entity: {
          type: 'person',
          persons: { some: { relationship: 'employee', deletedAt: null } },
        },
      },
      select: { entityId: true },
    });
    if (hasEmployeeSubject) return 'неизвестно';
    const hasExternal = await this.prisma.ideaBlockEntity.findFirst({
      where: {
        blockId,
        role: { in: ['subject', 'mentioned'] },
        entity: {
          type: 'person',
          persons: { some: { relationship: 'external', deletedAt: null } },
        },
      },
      select: { entityId: true },
    });
    return hasExternal ? 'клиент' : 'неизвестно';
  }

  private async resolveMeetingExternalLikely(blockId: string): Promise<boolean> {
    const ev = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId },
      select: { rawEventId: true },
    });
    if (ev.length === 0) return false;
    const raw = await this.prisma.rawEvent.findFirst({
      where: { id: { in: ev.map((e) => e.rawEventId) }, sourceType: 'meeting' },
      orderBy: { occurredAt: 'desc' },
      select: { sourceExternalId: true },
    });
    if (!raw?.sourceExternalId) return false;
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: raw.sourceExternalId },
      select: { type: true },
    });
    if (!meeting) return false;
    return ['sales', 'customer_success', 'partner', 'custdev'].includes(meeting.type);
  }

  private async upsertSingleProcessStep(args: {
    tenantId: string;
    processId: string;
    hint: NonNullable<RegulationDraft['processStepHint']>;
  }): Promise<void> {
    try {
      let order = args.hint.stepOrder ?? 0;
      if (order <= 0) {
        const last = await this.prisma.processStep.findFirst({
          where: { processId: args.processId },
          orderBy: { order: 'desc' },
          select: { order: true },
        });
        order = (last?.order ?? 0) + 1;
      }
      await this.prisma.processStep.upsert({
        where: { processId_order: { processId: args.processId, order } },
        update: {
          name: args.hint.stepName,
          description: args.hint.stepDescription ?? undefined,
        },
        create: {
          tenantId: args.tenantId,
          processId: args.processId,
          name: args.hint.stepName,
          order,
          description: args.hint.stepDescription ?? null,
        },
      });
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
            await this.prisma.processStep.upsert({
              where: { processId_order: { processId: args.processId, order } },
              update: { name: title, description: step.description },
              create: {
                tenantId: args.tenantId,
                processId: args.processId,
                name: title,
                order,
                description: step.description,
              },
            });
          }
        } catch (stepErr) {
          this.logger.debug(
            {
              processId: args.processId,
              order,
              err: stepErr instanceof Error ? stepErr.message : String(stepErr),
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
      enforcement === 'enforce' && proposed ? proposed.dataClass : args.blockDataClass;
    const audit: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      enforcement === 'enforce' && proposed
        ? (proposed.audit as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    return { dataClass: finalDc, dataClassAudit: audit };
  }
}

export interface RegulationDraft {
  kind: 'regulation' | 'process' | 'policy' | 'standard' | 'instruction';
  name: string;
  statement: string;
  scope?: string | null;
  ownerHint?: string | null;
  severity?: 'advisory' | 'mandatory' | 'blocking' | 'critical' | 'recommended' | 'standard' | null;
  category?: 'regulation' | 'standard' | null;
  processStepHint?: {
    processName: string;
    stepName: string;
    stepOrder?: number | null;
    stepDescription?: string | null;
  } | null;
  isOrgNorm?: boolean | null;
  ownerCompany?: 'наша' | 'клиент' | 'гость' | 'неизвестно' | null;
  isKeepableOrgNorm?: boolean | null;
  notabilityReason?: 'product_demo' | 'trivial_ui' | 'one_off' | null;
  extractionStatus?: 'существует' | 'нужен' | 'обсуждается' | null;
  roles?: string[];
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

void Prisma;
