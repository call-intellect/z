import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type Experiment,
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
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { CurationService } from '../../curation/services/curation.service';
import {
  EXPERIMENT_EXTRACT_JSON_SCHEMA,
  EXPERIMENT_EXTRACT_SCHEMA_NAME,
  EXPERIMENT_EXTRACT_SYSTEM_PROMPT,
  EXPERIMENT_EXTRACT_USER_TEMPLATE,
} from '../prompts/experiment-extract.prompt';

import { Specialist39ExperimentProbeService } from './specialist-3-9-experiment-probe.service';
import { resolveAxisTenantTop } from './tenant-top';


/**
 * SBA β-6 — Specialist39ExperimentsService.
 *
 * Логика специалиста 3.9 (Experiment Tracker):
 *   1. Принимаем IdeaBlock signalType ∈ { hypothesis, result, lesson }.
 *   2. LLM-extract: вернуть `{ name, hypothesisText, currentResult?, lessons?, status, confidence }`.
 *   3. Резолв существующего Experiment: ищем по совпадающим sourceBlockIds или
 *      KNN-эвристике (имя/hypothesis) внутри Org.
 *   4. Auto-status transition ТОЛЬКО при confidence ≥ 0.7 (§3 решение #3).
 *      Иначе оставляем status='hypothesis' и эмитим probe куратору.
 *   5. Создаём/обновляем Experiment + ExperimentVersion snapshot.
 *   6. Triage через CurationService (см. §5 контракт зонтичного).
 *   7. Probe-triggers: `result_without_lesson` сразу после persist'а.
 *
 * Контракт §5 sub-TZ:
 *   1. consumer `core.specialist-routing` jobName='3-9-experiments'.
 *   2. Prisma-модели Experiment + ExperimentVersion (β-6).
 *   3. triage перед канонизацией (resourceType='experiment').
 *   4. probe-events — Specialist39ExperimentProbeService (3 trigger'а).
 *   5. metrics — `core_specialist_*{type='experiment'}` + experiments_*.
 */
@Injectable()
export class Specialist39ExperimentsService {
  private readonly logger = new Logger(Specialist39ExperimentsService.name);

  static readonly SPECIALIST_NAME = '3-9-experiments';
  /** Порог auto-status transition. Ниже — оставляем 'hypothesis' + probe. */
  private static readonly AUTO_TRANSITION_MIN_CONFIDENCE = 0.7;
  /** Минимальная уверенность extraction, ниже которой пропускаем triage. */
  private static readonly MIN_EXTRACT_CONFIDENCE = 0.4;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(Specialist39ExperimentProbeService)
    private readonly probes: Specialist39ExperimentProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
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

  /**
   * Главная точка входа — вызывается из `experiment-detector.worker`.
   *
   * Идемпотентность: если блок уже включён в `sourceBlockIds` существующего
   * Experiment'а — апдейт идёт по тому же id. Если LLM возвращает мало
   * confidence — пропускаем (метрика skipped).
   */
  async processBlock(args: {
    tenantId: string;
    blockId: string;
  }): Promise<void> {
    const tenantTop = resolveAxisTenantTop(args.tenantId);
    const start = Date.now();

    let result: 'created' | 'updated' | 'skipped' | 'error' = 'skipped';
    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: args.blockId },
        include: { evidence: true },
      });
      if (!block) return;
      if (block.tenantId !== args.tenantId) return;

      // Sanity-фильтр: worker уже отфильтровал по jobName, но проверим.
      const allowed = new Set(['hypothesis', 'result', 'lesson']);
      if (!allowed.has(block.signalType)) return;

      // Быстрый exit: если этот блок уже привязан к Experiment'у — skip,
      // worker не должен запускаться повторно из-за идемпотентности jobId,
      // но защитимся от ручного re-enqueue.
      const existing = await this.findExistingByBlock({
        tenantId: args.tenantId,
        blockId: block.id,
      });

      const draft = await this.extractDraft(block);
      if (!draft) {
        result = 'skipped';
        return;
      }

      // Auto-transition gate: ТОЛЬКО при confidence ≥ 0.7 принимаем status
      // от LLM. Иначе оставляем 'hypothesis' и эмитим probe куратору
      // (через Specialist39ExperimentProbeService.checkNoOwnerForOrg cron
      // или сразу через result_without_lesson — ниже).
      const acceptedStatus =
        draft.confidence >= Specialist39ExperimentsService.AUTO_TRANSITION_MIN_CONFIDENCE
          ? draft.status
          : existing?.status ?? 'hypothesis';

      // Person'ы, упомянутые в блоке как subject.
      const personSubjectIds = await this.resolvePersonSubjects(block.id);

      // Уроки: если блок lesson — добавляем туда sourceBlockId.
      const newLessons = (draft.lessons ?? []).map((l) => ({
        text: l.text,
        type: l.type,
        sourceBlockId: block.id,
      }));

      let experiment: Experiment;
      if (existing) {
        experiment = await this.updateExisting({
          existing,
          block,
          draft,
          acceptedStatus,
          personSubjectIds,
          newLessons,
        });
        result = 'updated';
      } else {
        experiment = await this.createNew({
          block,
          draft,
          acceptedStatus,
          personSubjectIds,
          newLessons,
        });
        result = 'created';
      }

      // ExperimentVersion snapshot — immutable history.
      await this.writeVersionSnapshot({
        experiment,
        changeReason: existing ? 'updated_from_block' : 'created_from_block',
      });

      // Метрика: сколько уроков добавилось всего по эксперименту.
      const totalLessons = Array.isArray(experiment.lessonsJson)
        ? (experiment.lessonsJson as unknown[]).length
        : 0;
      if (newLessons.length > 0) {
        this.metrics.incExperimentLessonsExtracted({
          tenantTop,
          count: newLessons.length,
        });
      }

      // Triage перед канонизацией. dataClass наследуем от блока (но не выше
      // 'internal' по дефолту — experiment всё-таки операционная история).
      await this.triageProposed({
        tenantId: block.tenantId,
        resourceId: experiment.id,
        confidence: draft.confidence,
        proposedPayload: {
          name: experiment.name,
          hypothesisText: experiment.hypothesisText,
          status: experiment.status,
          currentResult: experiment.currentResult,
          lessonsJson: experiment.lessonsJson,
          sourceBlockIds: experiment.sourceBlockIds,
          personSubjectIds: experiment.personSubjectIds,
          confidence: Number(experiment.confidence),
        },
        dataClass: this.elevateDataClass(block.dataClass, 'internal'),
      });

      // Probe — синхронный «result_without_lesson».
      await this.probes.emitResultWithoutLesson(experiment);

      this.logger.log(
        {
          blockId: block.id,
          experimentId: experiment.id,
          status: experiment.status,
          confidence: Number(experiment.confidence),
          totalLessons,
          newLessons: newLessons.length,
        },
        'specialist-3-9: блок обработан',
      );
    } catch (err) {
      result = 'error';
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'experiment',
        reason: 'db_error',
      });
      this.logger.error(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-9.processBlock: внутренняя ошибка — пропускаю блок',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'experiment',
        seconds: (Date.now() - start) / 1000,
      });
      this.metrics.incExperimentDetectorRun({ tenantTop, result });
    }
  }

  // ─────────────────────────── extract ───────────────────────────────

  private async extractDraft(
    block: IdeaBlock & { evidence: IdeaBlockEvidence[] },
  ): Promise<ExperimentDraft | null> {
    const quotes = block.evidence
      .slice(0, 4)
      .map((e) => e.quote)
      .filter((q): q is string => Boolean(q) && q.length > 0);

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (контент блока) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    const rawUser = EXPERIMENT_EXTRACT_USER_TEMPLATE({
      signalType: block.signalType,
      blockName: block.name,
      criticalQuestion: block.criticalQuestion,
      trustedAnswer: block.trustedAnswer,
      tags: block.tags,
      evidenceQuotes: quotes,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'experiment-extract',
        systemPrompt: guardOn
          ? withInjectionGuard(EXPERIMENT_EXTRACT_SYSTEM_PROMPT)
          : EXPERIMENT_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: block.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: EXPERIMENT_EXTRACT_SCHEMA_NAME,
          schema: EXPERIMENT_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: block.id },
        dataClass: block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'experiment',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-9.extractDraft: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'experiment',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: ExperimentDraft | null;
    try {
      parsed = JSON.parse(result.text) as ExperimentDraft;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'experiment',
        reason: 'json_parse',
      });
      this.logger.warn(
        {
          blockId: block.id,
          err: err instanceof Error ? err.message : String(err),
          textSample: result.text.slice(0, 300),
        },
        'specialist-3-9.extractDraft: JSON.parse упал — skip',
      );
      return null;
    }

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.name ||
      !parsed.hypothesisText ||
      !parsed.status
    ) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'experiment',
        reason: 'schema_validation',
      });
      return null;
    }
    if (
      (parsed.confidence ?? 0) <
      Specialist39ExperimentsService.MIN_EXTRACT_CONFIDENCE
    ) {
      this.logger.debug(
        { blockId: block.id, confidence: parsed.confidence },
        'specialist-3-9.extractDraft: confidence слишком низкий — skip',
      );
      return null;
    }
    return parsed;
  }

  // ───────────────────────── persist helpers ─────────────────────────

  /**
   * Поиск существующего Experiment'а:
   *   1) Прямой — если блок уже в `sourceBlockIds[]`.
   *   2) Альтернативный — по совпадающим Person-subject'ам (best-effort,
   *      без cosine — embedding для Experiment добавим в γ+).
   */
  private async findExistingByBlock(args: {
    tenantId: string;
    blockId: string;
  }): Promise<Experiment | null> {
    return this.prisma.experiment.findFirst({
      where: {
        tenantId: args.tenantId,
        sourceBlockIds: { has: args.blockId },
      },
    });
  }

  private async createNew(args: {
    block: IdeaBlock;
    draft: ExperimentDraft;
    acceptedStatus: string;
    personSubjectIds: string[];
    newLessons: ReadonlyArray<{
      text: string;
      type: string;
      sourceBlockId: string;
    }>;
  }): Promise<Experiment> {
    const now = new Date();
    const startedAt =
      args.acceptedStatus === 'running' ||
      args.acceptedStatus === 'completed' ||
      args.acceptedStatus === 'dropped'
        ? now
        : null;
    const completedAt =
      args.acceptedStatus === 'completed' || args.acceptedStatus === 'dropped'
        ? now
        : null;

    return this.prisma.experiment.create({
      data: {
        tenantId: args.block.tenantId,
        name: args.draft.name.slice(0, 120),
        hypothesisText: args.draft.hypothesisText,
        status: args.acceptedStatus,
        currentResult: args.draft.currentResult ?? null,
        lessonsJson:
          args.newLessons.length > 0
            ? (args.newLessons as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        startedAt,
        completedAt,
        sourceBlockIds: [args.block.id],
        personSubjectIds: args.personSubjectIds,
        confidence: new Prisma.Decimal(
          Math.max(0, Math.min(1, args.draft.confidence)),
        ),
        lastConfirmedAt: now,
      },
    });
  }

  private async updateExisting(args: {
    existing: Experiment;
    block: IdeaBlock;
    draft: ExperimentDraft;
    acceptedStatus: string;
    personSubjectIds: string[];
    newLessons: ReadonlyArray<{
      text: string;
      type: string;
      sourceBlockId: string;
    }>;
  }): Promise<Experiment> {
    const now = new Date();
    const mergedBlocks = Array.from(
      new Set([...args.existing.sourceBlockIds, args.block.id]),
    );
    const mergedSubjects = Array.from(
      new Set([...args.existing.personSubjectIds, ...args.personSubjectIds]),
    );
    const existingLessons = Array.isArray(args.existing.lessonsJson)
      ? (args.existing.lessonsJson as unknown[])
      : [];
    const mergedLessons = [...existingLessons, ...args.newLessons];

    const startedAt =
      args.existing.startedAt ??
      (args.acceptedStatus === 'running' ||
      args.acceptedStatus === 'completed' ||
      args.acceptedStatus === 'dropped'
        ? now
        : null);
    const completedAt =
      args.existing.completedAt ??
      (args.acceptedStatus === 'completed' || args.acceptedStatus === 'dropped'
        ? now
        : null);

    return this.prisma.experiment.update({
      where: { id: args.existing.id },
      data: {
        // name/hypothesisText не перетираем — только если у существующего
        // короче / пусто (best-effort, чтобы не «откатывать» уточнения куратора).
        name:
          args.existing.name.length < args.draft.name.length
            ? args.draft.name.slice(0, 120)
            : args.existing.name,
        hypothesisText:
          args.existing.hypothesisText.length < 50
            ? args.draft.hypothesisText
            : args.existing.hypothesisText,
        status: args.acceptedStatus,
        currentResult:
          args.draft.currentResult ?? args.existing.currentResult,
        lessonsJson:
          mergedLessons.length > 0
            ? (mergedLessons as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
        sourceBlockIds: { set: mergedBlocks },
        personSubjectIds: { set: mergedSubjects },
        startedAt,
        completedAt,
        confidence: new Prisma.Decimal(
          Math.max(0, Math.min(1, args.draft.confidence)),
        ),
        lastConfirmedAt: now,
      },
    });
  }

  private async writeVersionSnapshot(args: {
    experiment: Experiment;
    changeReason: string;
  }): Promise<void> {
    try {
      const last = await this.prisma.experimentVersion.findFirst({
        where: { experimentId: args.experiment.id },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const next = (last?.versionNumber ?? 0) + 1;
      const created = await this.prisma.experimentVersion.create({
        data: {
          experimentId: args.experiment.id,
          tenantId: args.experiment.tenantId,
          versionNumber: next,
          snapshotJson: this.snapshotPayload(args.experiment),
          changeReason: args.changeReason.slice(0, 120),
        },
      });
      await this.prisma.experiment.update({
        where: { id: args.experiment.id },
        data: { currentVersionId: created.id },
      });
    } catch (err) {
      this.logger.warn(
        {
          experimentId: args.experiment.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-9.writeVersionSnapshot: пропускаю (best-effort)',
      );
    }
  }

  private snapshotPayload(exp: Experiment): Prisma.InputJsonValue {
    return {
      name: exp.name,
      hypothesisText: exp.hypothesisText,
      status: exp.status,
      currentResult: exp.currentResult,
      lessonsJson: exp.lessonsJson ?? null,
      sourceBlockIds: exp.sourceBlockIds,
      personSubjectIds: exp.personSubjectIds,
      ownerEntityId: exp.ownerEntityId,
      startedAt: exp.startedAt ? exp.startedAt.toISOString() : null,
      completedAt: exp.completedAt ? exp.completedAt.toISOString() : null,
      confidence: Number(exp.confidence),
    } as Prisma.InputJsonValue;
  }

  // ─────────────────────────── resolvers ─────────────────────────────

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

  private elevateDataClass(
    blockClass: DataClass,
    defaultClass: DataClass,
  ): DataClass {
    const order: DataClass[] = ['public', 'internal', 'sensitive', 'private'];
    const blockRank = order.indexOf(blockClass);
    const defaultRank = order.indexOf(defaultClass);
    return blockRank > defaultRank ? blockClass : defaultClass;
  }

  // ─────────────────────────── triage ────────────────────────────────

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
        resourceType: 'experiment',
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
        'specialist-3-9.triage: упал — Experiment остался без CurationItem',
      );
    }
  }
}

// ─────────────────────────── shared types ─────────────────────────

interface ExperimentDraft {
  name: string;
  hypothesisText: string;
  currentResult?: string | null;
  lessons?: Array<{
    text: string;
    type: 'what_worked' | 'what_failed' | 'next_time';
  }>;
  status: 'hypothesis' | 'running' | 'completed' | 'dropped' | 'paused';
  confidence: number;
}
