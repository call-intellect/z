import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { TypedConfigService } from '../../../common/config/index';
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
  KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA,
  KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME,
  KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT,
  KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE,
  type KnowledgeCloneExtractBlockInput,
} from '../prompts/knowledge-clone-extract.prompt';
import {
  KNOWLEDGE_CLONE_MERGE_JSON_SCHEMA,
  KNOWLEDGE_CLONE_MERGE_SCHEMA_NAME,
  KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT,
  KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE,
} from '../prompts/knowledge-clone-merge.prompt';
import { Specialist32ProbeService } from './specialist-3-2-probe.service';

/**
 * SBA β-2 — Specialist 3.2 (Knowledge Clone).
 *
 * Логика специалиста: набор IdeaBlock'ов сотрудника → LLM-extraction →
 * (опц. LLM-merge со старым профилем) → triage через CurationService →
 * auto-canonical (`Person.knowledgeProfile = profile`) или pending (CurationItem
 * для admin/manager review).
 *
 * Контракт §5 зонтичного — те же шаги, что у α-6 / α-7:
 *   1. consumer `core.knowledge-clone-rebuild` jobName='rebuild-knowledge-profile'
 *      (см. `KnowledgeCloneRebuildWorker`).
 *   2. Prisma — Person.knowledgeProfile (Json) + lastProfileBuildAt + profileBuildVersion.
 *   3. triage перед канонизацией — `resourceType='knowledge_profile'` НЕ
 *      в `CURATION_CRITICAL_TYPES_DEFAULT` → auto-canonical при confidence ≥ 0.85.
 *   4. probe-events — `Specialist32ProbeService` (new_expertise_detected /
 *      contradiction_detected).
 *   5. conflict-events — `ConflictService.report` при явных противоречиях
 *      («X не знает Y» vs «X знает Y»).
 *   6. chat-v2 support — `Specialist32CardHandler` (через CardSpecialistRegistry).
 *   7. metrics — `core_specialist_*` + `knowledge_clone_*`.
 */
@Injectable()
export class Specialist32Service {
  private readonly logger = new Logger(Specialist32Service.name);

  /** Имя специалиста (соответствует RouterService.SPECIALIST.KNOWLEDGE_CLONE). */
  static readonly SPECIALIST_NAME = '3-2-knowledge-clone';
  /** Тип ресурса для CurationService/ConflictService. */
  static readonly RESOURCE_TYPE = 'knowledge_profile';
  /** Тип для core_specialist_* меток (label `type`). */
  static readonly METRIC_TYPE = 'knowledge_profile';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(Specialist32ProbeService)
    private readonly probes: Specialist32ProbeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
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

  /**
   * Главный метод rebuild'а. Вызывается из `KnowledgeCloneRebuildWorker`.
   *
   * Best-effort: ловит ошибки на каждом шаге, фиксирует метрику
   * `core_specialist_extraction_failures_total`, не пробрасывает наружу
   * (воркер сам решает re-enqueue по политике BullMQ).
   */
  async rebuildForPerson(args: {
    tenantId: string;
    personId: string;
  }): Promise<void> {
    const start = Date.now();
    try {
      const person = await this.prisma.person.findUnique({
        where: { id: args.personId },
        select: {
          id: true,
          tenantId: true,
          name: true,
          entityId: true,
          relationship: true,
          deletedAt: true,
          knowledgeProfile: true,
          profileBuildVersion: true,
        },
      });
      if (!person || person.deletedAt) {
        this.logger.debug(
          { personId: args.personId },
          'specialist-3-2: Person не найден или удалён — skip',
        );
        return;
      }
      if (person.tenantId !== args.tenantId) {
        this.logger.warn(
          {
            personId: args.personId,
            expected: args.tenantId,
            actual: person.tenantId,
          },
          'specialist-3-2: tenant mismatch — skip',
        );
        return;
      }
      if (person.relationship !== 'employee') {
        // Knowledge Profile строится только для сотрудников. Для external
        // / candidate / former — пропускаем (это знание не наше).
        this.logger.debug(
          { personId: person.id, relationship: person.relationship },
          'specialist-3-2: Person не сотрудник — skip',
        );
        return;
      }

      // 1. Собрать блоки Person'а за окно lookbackMonths.
      const blocks = await this.loadBlocksForPerson({
        tenantId: args.tenantId,
        personId: person.id,
        entityId: person.entityId,
      });

      const minBlocks = this.cfg.knowledgeClone.minBlocksForProfile;
      if (blocks.length < minBlocks) {
        this.logger.debug(
          { personId: person.id, blocksCount: blocks.length, minBlocks },
          'specialist-3-2: блоков меньше порога — skip',
        );
        return;
      }

      // 2. LLM-extract → черновик.
      const draft = await this.extractDraft({
        tenantId: args.tenantId,
        personName: person.name,
        blocks,
      });
      if (!draft) {
        return; // метрика уже инкрементирована внутри extractDraft.
      }

      // 3. Если есть старый профиль — LLM-merge.
      let merged: KnowledgeProfileDraft = draft;
      const existingProfile = parseExistingProfile(person.knowledgeProfile);
      if (existingProfile && existingProfile.categories.length > 0) {
        const mergedDraft = await this.mergeWithExisting({
          tenantId: args.tenantId,
          personName: person.name,
          oldProfile: existingProfile,
          newDraft: draft,
        });
        if (mergedDraft) merged = mergedDraft;
      }

      // 4. Confidence профиля — берём «средне-взвешенный» по категориям.
      const profileConfidence = computeProfileConfidence(merged);

      // 5. Conflict detection (явные противоречия между старым и новым).
      let conflictSignal: 'none' | 'soft' | 'hard' = 'none';
      if (existingProfile && existingProfile.categories.length > 0) {
        const contradiction = detectContradictions(existingProfile, merged);
        if (contradiction.length > 0) {
          conflictSignal = 'soft';
          try {
            await this.conflicts.report({
              tenantId: args.tenantId,
              resourceType: Specialist32Service.RESOURCE_TYPE,
              existingId: person.id,
              newId: `${person.id}:next`,
              relationType: 'contradicts',
              detectedBy: 'specialist',
              evidence: {
                specialistName: Specialist32Service.SPECIALIST_NAME,
                personName: person.name,
                contradictions: contradiction.slice(0, 5),
              },
            });
            this.metrics.incCoreSpecialistConflictEvent({
              type: Specialist32Service.METRIC_TYPE,
            });
          } catch (err) {
            this.logger.warn(
              {
                personId: person.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'specialist-3-2: conflict.report упал — продолжаем',
            );
          }
        }
      }

      // 6. Сериализованный профиль (для CurationItem.proposedPayload + apply).
      const nextVersion = person.profileBuildVersion + 1;
      const builtAt = new Date().toISOString();
      const serialized: SerializedKnowledgeProfile = {
        version: nextVersion,
        builtAt,
        categories: merged.categories,
        experienceHighlights: merged.experienceHighlights,
      };

      // 7. Triage. knowledge_profile НЕ в critical-types → auto-canonical
      //    при confidence ≥ autoThresholdDefault.
      let triageDecision: 'auto' | 'light' | 'deep' = 'deep';
      try {
        const res = await this.curation.triage({
          tenantId: args.tenantId,
          resourceType: Specialist32Service.RESOURCE_TYPE,
          resourceId: person.id,
          confidence: profileConfidence,
          proposedPayload: serialized as unknown as Record<string, unknown>,
          conflictSignal,
          dataClass: 'internal',
        });
        triageDecision = res.decision;
      } catch (err) {
        this.metrics.incCoreSpecialistExtractionFailure({
          type: Specialist32Service.METRIC_TYPE,
          reason: 'triage_error',
        });
        this.logger.warn(
          {
            personId: person.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-2: triage упал — продолжаем без записи',
        );
        return;
      }

      // 8. На auto — пишем профиль в Person.
      if (triageDecision === 'auto') {
        try {
          await this.prisma.person.update({
            where: { id: person.id },
            data: {
              knowledgeProfile: serialized as unknown as Prisma.InputJsonValue,
              lastProfileBuildAt: new Date(),
              profileBuildVersion: nextVersion,
            },
          });
          // Метрики профиля.
          this.metrics.observeKnowledgeCloneCategoriesPerProfile(
            merged.categories.length,
          );
          this.metrics.observeKnowledgeCloneProfileSizeKb(
            estimateProfileSizeKb(serialized),
          );
          this.metrics.incCoreSpecialistCards({
            type: Specialist32Service.METRIC_TYPE,
            status: 'canonical',
          });
        } catch (err) {
          this.metrics.incCoreSpecialistExtractionFailure({
            type: Specialist32Service.METRIC_TYPE,
            reason: 'db_error',
          });
          this.logger.error(
            {
              personId: person.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-2.applyProfile: ошибка записи в Person — пропускаю',
          );
          return;
        }
      } else {
        this.metrics.incCoreSpecialistCards({
          type: Specialist32Service.METRIC_TYPE,
          status: 'pending',
        });
      }

      // 9. Probe-events. На auto — направление direct manager'у про новый
      //    expertise (с low/medium тоже отправляем, чтобы менеджер мог
      //    подсветить).
      await this.probes.checkAndEmitProbes({
        tenantId: args.tenantId,
        personId: person.id,
        personName: person.name,
        oldProfile: existingProfile,
        newProfile: serialized,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist32Service.METRIC_TYPE,
        reason: 'rebuild_error',
      });
      this.logger.error(
        {
          personId: args.personId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-2.rebuildForPerson: внутренняя ошибка — skip',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: Specialist32Service.METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }
  }

  // ──────────────────── приватные методы ────────────────────

  /**
   * Загружает блоки Person'а за окно `lookbackMonths` (Слой 2):
   *   - IdeaBlockEntity, где Person.entityId упомянут с role IN ('subject', 'mentioned');
   *   - block.status = 'canonical';
   *   - createdAt >= now - lookbackMonths.
   *
   * Возвращает массив (свежие → старые), ограниченный 60 блоками
   * (это LLM-budget; больше — будет выходить токен-лимит).
   */
  private async loadBlocksForPerson(args: {
    tenantId: string;
    personId: string;
    entityId: string | null;
  }): Promise<KnowledgeCloneExtractBlockInput[]> {
    if (!args.entityId) {
      this.logger.debug(
        { personId: args.personId },
        'specialist-3-2.loadBlocksForPerson: Person.entityId не заполнен — нечего извлекать',
      );
      return [];
    }

    const lookbackMs =
      this.cfg.knowledgeClone.lookbackMonths * 30 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs);

    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: args.entityId,
        role: { in: ['subject', 'mentioned'] },
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
      take: 200,
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];
    if (blockIds.length === 0) return [];

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      include: {
        evidence: {
          select: { quote: true },
          take: 3,
        },
        entities: {
          select: { entityId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
    });

    return blocks.map((b) => ({
      blockId: b.id,
      name: b.name,
      signalType: b.signalType,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      tags: b.tags,
      relatedEntityIds: b.entities.map((e) => e.entityId),
      createdAt: b.createdAt.toISOString(),
      quotes: b.evidence
        .map((e) => e.quote)
        .filter((q): q is string => typeof q === 'string' && q.length > 0),
    }));
  }

  /**
   * LLM-extraction набора блоков в черновик профиля. Best-effort.
   */
  private async extractDraft(args: {
    tenantId: string;
    personName: string;
    blocks: readonly KnowledgeCloneExtractBlockInput[];
  }): Promise<KnowledgeProfileDraft | null> {
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (имя + блоки сотрудника) в маркеры.
    const guardOnExtract = this.isPromptInjectionGuardEnabled();
    const rawUserExtract = KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE({
      personName: args.personName,
      blocks: args.blocks,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'knowledge-clone-extract',
        systemPrompt: guardOnExtract
          ? withInjectionGuard(KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT)
          : KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOnExtract ? wrapUserData(rawUserExtract) : rawUserExtract,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: KNOWLEDGE_CLONE_EXTRACT_SCHEMA_NAME,
          schema: KNOWLEDGE_CLONE_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist32Service.METRIC_TYPE,
        reason: 'llm_error',
      });
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-2.extractDraft: LLM упал — skip',
      );
      return null;
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist32Service.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    return parseDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist32Service.METRIC_TYPE,
        reason,
      });
    });
  }

  /**
   * LLM-merge старого профиля и нового черновика.
   */
  private async mergeWithExisting(args: {
    tenantId: string;
    personName: string;
    oldProfile: KnowledgeProfileDraft;
    newDraft: KnowledgeProfileDraft;
  }): Promise<KnowledgeProfileDraft | null> {
    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (старый профиль + новый draft) в маркеры.
    const guardOnMerge = this.isPromptInjectionGuardEnabled();
    const rawUserMerge = KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE({
      personName: args.personName,
      nowIso: new Date().toISOString(),
      oldProfileJson: JSON.stringify(args.oldProfile),
      newDraftJson: JSON.stringify(args.newDraft),
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'knowledge-clone-merge',
        systemPrompt: guardOnMerge
          ? withInjectionGuard(KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT)
          : KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT,
        userMessage: guardOnMerge ? wrapUserData(rawUserMerge) : rawUserMerge,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: KNOWLEDGE_CLONE_MERGE_SCHEMA_NAME,
          schema: KNOWLEDGE_CLONE_MERGE_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist32Service.METRIC_TYPE,
        reason: 'merge_llm_error',
      });
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-2.mergeWithExisting: LLM упал — использую новый draft как итог',
      );
      return args.newDraft;
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist32Service.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    const parsed = parseDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist32Service.METRIC_TYPE,
        reason: `merge_${reason}`,
      });
    });
    return parsed ?? args.newDraft;
  }
}

// ──────────────────────── shared types ────────────────────────

export interface KnowledgeProfileCategory {
  name: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sampleStatements: Array<{ quote: string; blockId: string }>;
  relatedEntityIds: string[];
  lastObservedAt: string;
}

export interface KnowledgeProfileHighlight {
  summary: string;
  blockIds: string[];
}

export interface KnowledgeProfileDraft {
  categories: KnowledgeProfileCategory[];
  experienceHighlights: KnowledgeProfileHighlight[];
}

/**
 * Финальная Json-форма, которую пишем в `Person.knowledgeProfile`.
 * Включает `version` (= profileBuildVersion) и `builtAt`.
 */
export interface SerializedKnowledgeProfile extends KnowledgeProfileDraft {
  version: number;
  builtAt: string;
}

// ──────────────────────── helpers ────────────────────────

function parseDraft(
  text: string,
  onFailure: (reason: string) => void,
): KnowledgeProfileDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    onFailure('json_parse');
    return null;
  }
  if (!parsed || typeof parsed !== 'object') {
    onFailure('schema_validation');
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const categoriesRaw = Array.isArray(obj.categories) ? obj.categories : [];
  const highlightsRaw = Array.isArray(obj.experienceHighlights)
    ? obj.experienceHighlights
    : [];

  const categories: KnowledgeProfileCategory[] = [];
  for (const c of categoriesRaw) {
    if (!c || typeof c !== 'object') continue;
    const cat = c as Record<string, unknown>;
    if (typeof cat.name !== 'string' || cat.name.length < 2) continue;
    const conf = cat.confidence === 'low' || cat.confidence === 'medium' || cat.confidence === 'high' ? cat.confidence : 'low';
    const obsCount =
      typeof cat.observationCount === 'number' && cat.observationCount > 0
        ? Math.min(1_000, Math.floor(cat.observationCount))
        : 1;
    const sampleStatements: Array<{ quote: string; blockId: string }> = [];
    if (Array.isArray(cat.sampleStatements)) {
      for (const s of cat.sampleStatements.slice(0, 3)) {
        if (!s || typeof s !== 'object') continue;
        const st = s as Record<string, unknown>;
        if (typeof st.quote === 'string' && typeof st.blockId === 'string') {
          sampleStatements.push({
            quote: st.quote.slice(0, 600),
            blockId: st.blockId.slice(0, 64),
          });
        }
      }
    }
    const relatedEntityIds: string[] = [];
    if (Array.isArray(cat.relatedEntityIds)) {
      for (const id of cat.relatedEntityIds.slice(0, 20)) {
        if (typeof id === 'string' && id.length > 0) {
          relatedEntityIds.push(id);
        }
      }
    }
    const lastObservedAt =
      typeof cat.lastObservedAt === 'string' && cat.lastObservedAt.length >= 10
        ? cat.lastObservedAt
        : new Date().toISOString();
    categories.push({
      name: cat.name.slice(0, 200),
      confidence: conf,
      observationCount: obsCount,
      sampleStatements,
      relatedEntityIds,
      lastObservedAt,
    });
  }

  const experienceHighlights: KnowledgeProfileHighlight[] = [];
  for (const h of highlightsRaw.slice(0, 10)) {
    if (!h || typeof h !== 'object') continue;
    const obj = h as Record<string, unknown>;
    if (typeof obj.summary !== 'string') continue;
    const blockIds: string[] = [];
    if (Array.isArray(obj.blockIds)) {
      for (const id of obj.blockIds.slice(0, 10)) {
        if (typeof id === 'string' && id.length > 0) blockIds.push(id);
      }
    }
    experienceHighlights.push({
      summary: obj.summary.slice(0, 400),
      blockIds,
    });
  }

  if (categories.length === 0 && experienceHighlights.length === 0) {
    onFailure('schema_validation');
    return null;
  }
  return { categories, experienceHighlights };
}

function parseExistingProfile(
  raw: Prisma.JsonValue | null,
): KnowledgeProfileDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return parseDraft(JSON.stringify(raw), () => void 0);
}

function computeProfileConfidence(profile: KnowledgeProfileDraft): number {
  if (profile.categories.length === 0) return 0.4;
  const weights: Record<string, number> = { low: 0.5, medium: 0.75, high: 0.92 };
  let sum = 0;
  let count = 0;
  for (const c of profile.categories) {
    sum += weights[c.confidence] ?? 0.5;
    count++;
  }
  if (count === 0) return 0.4;
  const avg = sum / count;
  // На высокое число категорий и наблюдений — лёгкий boost.
  const obsBoost = Math.min(
    0.05,
    profile.categories.reduce((acc, c) => acc + Math.log2(1 + c.observationCount), 0) /
      200,
  );
  return Math.min(1, avg + obsBoost);
}

function estimateProfileSizeKb(profile: SerializedKnowledgeProfile): number {
  try {
    return Buffer.byteLength(JSON.stringify(profile), 'utf8') / 1024;
  } catch {
    return 0;
  }
}

interface Contradiction {
  category: string;
  oldStatement: string;
  newStatement: string;
}

/**
 * Эвристика поиска явных противоречий: если в новом профиле появилось имя
 * категории, противоположное старому (например, «не знает X» vs «знает X»
 * — через токен `не` в начале). Очень осторожная — не должна давать ложных
 * срабатываний, поэтому ловит только обратные пары «знает/не знает» в
 * sampleStatements одной категории.
 */
function detectContradictions(
  oldProfile: KnowledgeProfileDraft,
  newProfile: KnowledgeProfileDraft,
): Contradiction[] {
  const out: Contradiction[] = [];
  for (const newCat of newProfile.categories) {
    const oldCat = oldProfile.categories.find(
      (c) => c.name.trim().toLowerCase() === newCat.name.trim().toLowerCase(),
    );
    if (!oldCat) continue;
    for (const oldStmt of oldCat.sampleStatements) {
      const oldNegative = isNegativeStatement(oldStmt.quote);
      for (const newStmt of newCat.sampleStatements) {
        const newNegative = isNegativeStatement(newStmt.quote);
        if (oldNegative !== newNegative) {
          out.push({
            category: newCat.name,
            oldStatement: oldStmt.quote,
            newStatement: newStmt.quote,
          });
          break;
        }
      }
    }
  }
  return out;
}

function isNegativeStatement(text: string): boolean {
  const t = text.trim().toLowerCase();
  return (
    /^не\s/i.test(t) ||
    t.includes(' не знает') ||
    t.includes(' не умеет') ||
    t.includes(' не разбирается')
  );
}

