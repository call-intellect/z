import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DataClass, Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type LlmCallResult,
  LlmRouterService,
} from '../../ai/services/llm-router.service';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';

import {
  HELPFULNESS_DETECT_JSON_SCHEMA,
  HELPFULNESS_DETECT_SCHEMA_NAME,
  HELPFULNESS_DETECT_SYSTEM_PROMPT,
  HELPFULNESS_DETECT_USER_TEMPLATE,
  HELPFULNESS_TRAIT_MERGE_JSON_SCHEMA,
  HELPFULNESS_TRAIT_MERGE_SCHEMA_NAME,
  HELPFULNESS_TRAIT_MERGE_SYSTEM_PROMPT,
  HELPFULNESS_TRAIT_MERGE_USER_TEMPLATE,
} from '../prompts/helpfulness.prompts';

/**
 * Допустимые traitType — синхронизировано с SignalType + sub-ТЗ §«Паттерны
 * для извлечения». Первые 5 — публичные, последние 2 — restricted (только
 * админ + руководитель).
 */
export const ALLOWED_TRAIT_TYPES = [
  'help_provided',
  'proactive_hint',
  'mentoring',
  'emotional_support',
  'constructive_feedback',
  'question_unanswered',
  'question_acknowledged_no_action',
] as const;

export type HelpfulnessTraitType = (typeof ALLOWED_TRAIT_TYPES)[number];

/** Тип ResourceType для RBAC. */
export const HELPFULNESS_RESOURCE_TYPE = 'helpfulness_trait';

/**
 * traitType, которые публикуются ТОЛЬКО для админа + руководителя (никогда
 * публично). Этическая защита.
 */
export const PRIVATE_TRAIT_TYPES = new Set<HelpfulnessTraitType>([
  'question_unanswered',
  'question_acknowledged_no_action',
]);

/**
 * KNN-порог cosine distance (`<=>`) — ниже = ближе. Sub-ТЗ §«Worker» порог
 * 0.82 на cosine similarity ⇔ distance ≤ 0.18. Берём чуть строже (0.15)
 * для уверенного merge.
 */
const KNN_MERGE_DISTANCE_THRESHOLD = 0.15;

/** KNN top-K — сколько ближайших trait'ов запрашиваем при merge. */
const KNN_TOP_K = 5;

/** Минимальный confidence для записи trait'а (ниже — выбрасываем). */
const MIN_TRAIT_CONFIDENCE = 0.4;

/** Тип LLM-ответа detect. */
interface DetectedTraitLlm {
  traitType: string;
  helperUserHint: string;
  recipientUserHint?: string;
  topicHint?: string;
  intensity: number;
  evidenceQuote: string;
  confidence: number;
}

interface DetectLlmResponse {
  traits: DetectedTraitLlm[];
}

interface MergeLlmResponse {
  decision: 'merge' | 'keep_separate';
  mergedTopicHint?: string;
  mergedIntensity?: number;
  reason?: string;
}

/**
 * Главный сервис Specialist 3.8 (Helpfulness Agent).
 *
 * Контракт:
 *   1. `processBlock` — публичный вход для worker'а.
 *   2. Внутри — LLM detect → resolve helperUserId/recipientUserId по hint'у
 *      (через Person.name fuzzy) → embedding → KNN merge / create.
 *   3. visibility принудительно 'restricted' для PRIVATE_TRAIT_TYPES.
 *   4. Best-effort: ловит ошибки, инкрементит метрики, не throw'ит наружу.
 *
 * Метрики: переиспользуем `coreSpecialist*` с type='helpfulness_trait'.
 */
@Injectable()
export class Specialist38HelpfulnessService {
  private readonly logger = new Logger(Specialist38HelpfulnessService.name);

  static readonly SPECIALIST_NAME = '3-8-helpfulness';
  static readonly METRIC_TYPE = 'helpfulness_trait';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Главный метод обработки одного IdeaBlock'а.
   *
   * Best-effort: ловит ошибки на каждом шаге, метрики инкрементит, не
   * throw'ит наружу (воркер решает re-enqueue по политике BullMQ).
   */
  async processBlock(args: {
    tenantId: string;
    blockId: string;
  }): Promise<{ traitsCreated: number; traitsMerged: number } | null> {
    try {
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: args.blockId },
        select: {
          id: true,
          tenantId: true,
          name: true,
          signalType: true,
          status: true,
          criticalQuestion: true,
          trustedAnswer: true,
          tags: true,
          dataClass: true,
          createdAt: true,
          evidence: {
            select: { quote: true },
            take: 8,
          },
        },
      });
      if (!block) {
        this.logger.debug(
          { blockId: args.blockId },
          'specialist-3-8: блок не найден — skip',
        );
        return null;
      }
      if (block.tenantId !== args.tenantId) {
        this.logger.warn(
          {
            blockId: block.id,
            expected: args.tenantId,
            actual: block.tenantId,
          },
          'specialist-3-8: tenant mismatch — skip',
        );
        return null;
      }
      if (block.status !== 'canonical') {
        return null;
      }

      const detected = await this.detectTraits({
        tenantId: args.tenantId,
        block: {
          id: block.id,
          name: block.name,
          signalType: block.signalType,
          criticalQuestion: block.criticalQuestion,
          trustedAnswer: block.trustedAnswer,
          tags: block.tags,
          quotes: block.evidence
            .map((e) => e.quote)
            .filter((q): q is string => typeof q === 'string' && q.length > 0),
          dataClass: block.dataClass as DataClass,
        },
      });
      if (!detected || detected.length === 0) {
        return { traitsCreated: 0, traitsMerged: 0 };
      }

      let created = 0;
      let merged = 0;
      for (const trait of detected) {
        try {
          const persisted = await this.persistTrait({
            tenantId: args.tenantId,
            blockId: block.id,
            trait,
          });
          if (persisted === 'created') created += 1;
          if (persisted === 'merged') merged += 1;
        } catch (err) {
          this.logger.warn(
            {
              blockId: block.id,
              traitType: trait.traitType,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-8.persistTrait: упало — пропускаю trait',
          );
        }
      }

      return { traitsCreated: created, traitsMerged: merged };
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        reason: 'process_error',
      });
      this.logger.error(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-8.processBlock: внутренняя ошибка — пропускаю блок',
      );
      return null;
    }
  }

  // ─────────────────────────── LLM detect ─────────────────────────────────

  private async detectTraits(args: {
    tenantId: string;
    block: {
      id: string;
      name: string;
      signalType: string;
      criticalQuestion: string;
      trustedAnswer: string;
      tags: string[];
      quotes: string[];
      dataClass: DataClass;
    };
  }): Promise<DetectedTraitLlm[] | null> {
    const start = Date.now();
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'helpfulness-detect',
        systemPrompt: HELPFULNESS_DETECT_SYSTEM_PROMPT,
        userMessage: HELPFULNESS_DETECT_USER_TEMPLATE({
          blockName: args.block.name,
          signalType: args.block.signalType,
          criticalQuestion: args.block.criticalQuestion,
          trustedAnswer: args.block.trustedAnswer,
          tags: args.block.tags,
          evidenceQuotes: args.block.quotes,
        }),
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: HELPFULNESS_DETECT_SCHEMA_NAME,
          schema: HELPFULNESS_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'idea_block', id: args.block.id },
        dataClass: args.block.dataClass,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          blockId: args.block.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-8.detectTraits: LLM упал — skip',
      );
      return null;
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    let parsed: DetectLlmResponse;
    try {
      parsed = JSON.parse(result.text) as DetectLlmResponse;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        reason: 'json_parse',
      });
      return null;
    }
    if (!parsed || !Array.isArray(parsed.traits)) return null;

    const filtered: DetectedTraitLlm[] = [];
    for (const t of parsed.traits) {
      if (!t || typeof t !== 'object') continue;
      if (!Specialist38HelpfulnessService.isValidTraitType(t.traitType)) continue;
      if (typeof t.helperUserHint !== 'string' || t.helperUserHint.length === 0) {
        continue;
      }
      if (
        typeof t.intensity !== 'number' ||
        t.intensity < 0 ||
        t.intensity > 1
      ) {
        continue;
      }
      if (
        typeof t.confidence !== 'number' ||
        t.confidence < MIN_TRAIT_CONFIDENCE ||
        t.confidence > 1
      ) {
        continue;
      }
      if (typeof t.evidenceQuote !== 'string' || t.evidenceQuote.length === 0) {
        continue;
      }
      filtered.push(t);
    }
    return filtered;
  }

  // ─────────────────────────── persist + merge ────────────────────────────

  /**
   * Пишет trait в БД. Если есть похожий — merge через LLM-арбитр.
   * Возвращает 'created' | 'merged' | 'skipped'.
   */
  private async persistTrait(args: {
    tenantId: string;
    blockId: string;
    trait: DetectedTraitLlm;
  }): Promise<'created' | 'merged' | 'skipped'> {
    const helperUserId = await this.resolveUserIdByHint({
      tenantId: args.tenantId,
      hint: args.trait.helperUserHint,
    });
    if (!helperUserId) {
      this.logger.debug(
        { hint: args.trait.helperUserHint },
        'specialist-3-8: helperUserId не резолвится — skip',
      );
      return 'skipped';
    }

    const recipientUserId = args.trait.recipientUserHint
      ? await this.resolveUserIdByHint({
          tenantId: args.tenantId,
          hint: args.trait.recipientUserHint,
        })
      : null;

    const traitType = args.trait.traitType as HelpfulnessTraitType;
    const visibility = PRIVATE_TRAIT_TYPES.has(traitType)
      ? 'restricted'
      : 'internal';
    const topicHint = args.trait.topicHint?.slice(0, 120) ?? null;
    const evidenceQuote = args.trait.evidenceQuote.slice(0, 500);
    const now = new Date();

    // Embedding для KNN merge.
    const embeddingText = this.buildEmbeddingText({
      traitType,
      topicHint,
      evidenceQuote,
    });
    const embedding = await this.embedSafe(embeddingText);

    // KNN search — ищем существующие trait'ы того же helper'а с похожим topicHint.
    let mergedExistingId: string | null = null;
    let mergeIntensity: number | null = null;
    let mergeTopicHint: string | null = null;
    if (embedding) {
      const nearest = await this.knnSearchSimilar({
        tenantId: args.tenantId,
        helperUserId,
        traitType,
        embedding,
      });
      if (nearest) {
        // LLM-арбитр.
        const decision = await this.callMergeArbiter({
          tenantId: args.tenantId,
          existing: nearest,
          incoming: {
            traitType,
            topicHint,
            intensity: args.trait.intensity,
            evidenceQuote,
            lastObservedAt: now.toISOString(),
          },
        });
        if (decision && decision.decision === 'merge') {
          mergedExistingId = nearest.id;
          mergeIntensity = Math.min(
            1,
            Math.max(
              decision.mergedIntensity ?? args.trait.intensity,
              Number(nearest.intensity),
            ),
          );
          mergeTopicHint = decision.mergedTopicHint?.slice(0, 120) ?? nearest.topicHint;
        }
      }
    }

    if (mergedExistingId) {
      // Update existing.
      await this.prisma.helpfulnessTrait.update({
        where: { id: mergedExistingId },
        data: {
          intensity:
            mergeIntensity !== null
              ? new Prisma.Decimal(mergeIntensity)
              : undefined,
          topicHint: mergeTopicHint ?? undefined,
          sourceBlockIds: {
            push: args.blockId,
          },
          evidenceQuote: evidenceQuote,
          lastObservedAt: now,
          status: 'active',
          decayedAt: null,
        },
      });
      // Embedding обновим отдельно (вне prisma model, поскольку Unsupported).
      if (embedding) {
        await this.writeEmbeddingSafe({
          id: mergedExistingId,
          embedding,
        });
      }
      this.metrics.incCoreSpecialistCards({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        status: 'merged',
      });
      return 'merged';
    }

    // Create new.
    const created = await this.prisma.helpfulnessTrait.create({
      data: {
        tenantId: args.tenantId,
        helperUserId,
        recipientUserId,
        traitType,
        intensity: new Prisma.Decimal(args.trait.intensity),
        topicHint,
        sourceBlockIds: [args.blockId],
        evidenceQuote,
        confidence: new Prisma.Decimal(args.trait.confidence),
        visibility,
        lastObservedAt: now,
        status: 'active',
      },
    });
    if (embedding) {
      await this.writeEmbeddingSafe({ id: created.id, embedding });
    }
    this.metrics.incCoreSpecialistCards({
      type: Specialist38HelpfulnessService.METRIC_TYPE,
      status: 'canonical',
    });
    return 'created';
  }

  // ─────────────────────────── KNN + embeddings ───────────────────────────

  private async knnSearchSimilar(args: {
    tenantId: string;
    helperUserId: string;
    traitType: HelpfulnessTraitType;
    embedding: number[];
  }): Promise<{
    id: string;
    traitType: string;
    topicHint: string | null;
    intensity: number;
    evidenceQuote: string | null;
    lastObservedAt: Date;
    distance: number;
  } | null> {
    try {
      const vec = `[${args.embedding.join(',')}]`;
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{
          id: string;
          traitType: string;
          topicHint: string | null;
          intensity: string;
          evidenceQuote: string | null;
          lastObservedAt: Date;
          distance: number;
        }>
      >(
        `SELECT "id", "traitType", "topicHint", "intensity",
                "evidenceQuote", "lastObservedAt",
                ("embedding" <=> $4::vector) AS distance
         FROM "HelpfulnessTrait"
         WHERE "tenantId" = $1
           AND "helperUserId" = $2
           AND "traitType" = $3
           AND "status" = 'active'
           AND "embedding" IS NOT NULL
         ORDER BY "embedding" <=> $4::vector
         LIMIT ${KNN_TOP_K}`,
        args.tenantId,
        args.helperUserId,
        args.traitType,
        vec,
      );
      if (rows.length === 0) return null;
      const best = rows[0];
      if (!best) return null;
      if (Number(best.distance) > KNN_MERGE_DISTANCE_THRESHOLD) return null;
      return {
        id: best.id,
        traitType: best.traitType,
        topicHint: best.topicHint,
        intensity: Number(best.intensity),
        evidenceQuote: best.evidenceQuote,
        lastObservedAt: best.lastObservedAt,
        distance: Number(best.distance),
      };
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-8.knnSearchSimilar: pgvector KNN упал — пропускаю',
      );
      return null;
    }
  }

  private async embedSafe(text: string): Promise<number[] | null> {
    const trimmed = text.trim().slice(0, 2_000);
    if (!trimmed) return null;
    try {
      return await this.embedder.embedQuery(trimmed);
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-8.embedSafe: embedding упал — null',
      );
      return null;
    }
  }

  private async writeEmbeddingSafe(args: {
    id: string;
    embedding: number[];
  }): Promise<void> {
    try {
      const vec = `[${args.embedding.join(',')}]`;
      await this.prisma.$executeRawUnsafe(
        `UPDATE "HelpfulnessTrait" SET "embedding" = $1::vector WHERE "id" = $2`,
        vec,
        args.id,
      );
    } catch (err) {
      this.logger.debug(
        {
          id: args.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-8.writeEmbeddingSafe: запись embedding упала — пропускаю',
      );
    }
  }

  private buildEmbeddingText(args: {
    traitType: string;
    topicHint: string | null;
    evidenceQuote: string;
  }): string {
    return [args.traitType, args.topicHint ?? '', args.evidenceQuote]
      .filter((s) => s && s.length > 0)
      .join(' | ')
      .slice(0, 1_000);
  }

  // ─────────────────────────── LLM merge arbiter ──────────────────────────

  private async callMergeArbiter(args: {
    tenantId: string;
    existing: {
      id: string;
      traitType: string;
      topicHint: string | null;
      intensity: number;
      evidenceQuote: string | null;
      lastObservedAt: Date;
    };
    incoming: {
      traitType: string;
      topicHint: string | null;
      intensity: number;
      evidenceQuote: string;
      lastObservedAt: string;
    };
  }): Promise<MergeLlmResponse | null> {
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'helpfulness-trait-merge',
        systemPrompt: HELPFULNESS_TRAIT_MERGE_SYSTEM_PROMPT,
        userMessage: HELPFULNESS_TRAIT_MERGE_USER_TEMPLATE({
          existing: {
            traitType: args.existing.traitType,
            topicHint: args.existing.topicHint,
            intensity: args.existing.intensity,
            evidenceQuote: args.existing.evidenceQuote,
            lastObservedAt: args.existing.lastObservedAt.toISOString(),
          },
          incoming: args.incoming,
        }),
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: HELPFULNESS_TRAIT_MERGE_SCHEMA_NAME,
          schema: HELPFULNESS_TRAIT_MERGE_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.logger.debug(
        {
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-8.callMergeArbiter: LLM упал — keep_separate fallback',
      );
      return { decision: 'keep_separate' };
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    try {
      const parsed = JSON.parse(result.text) as MergeLlmResponse;
      if (parsed.decision !== 'merge' && parsed.decision !== 'keep_separate') {
        return { decision: 'keep_separate' };
      }
      return parsed;
    } catch {
      return { decision: 'keep_separate' };
    }
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  /**
   * Резолвит helperUserId по строке-hint'у (имя/email/@username из LLM).
   * Шаги:
   *   1. Точное совпадение Person.email (если выглядит как email).
   *   2. Точное совпадение Person.name.
   *   3. Если Person.userId != null — возвращаем его.
   *   4. Иначе пробуем @-mention отрезать `@` и поискать по name.
   *
   * Возвращает только реального User.id (Person.userId != null).
   * Внешних/удалённых пропускаем.
   */
  private async resolveUserIdByHint(args: {
    tenantId: string;
    hint: string;
  }): Promise<string | null> {
    const raw = args.hint.trim();
    if (!raw) return null;
    const cleaned = raw.startsWith('@') ? raw.slice(1) : raw;

    const isEmail = cleaned.includes('@') && cleaned.includes('.');
    const candidates = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        relationship: 'employee',
        deletedAt: null,
        userId: { not: null },
        OR: isEmail
          ? [{ email: cleaned }]
          : [
              { name: cleaned },
              { name: { contains: cleaned, mode: 'insensitive' } },
            ],
      },
      select: { userId: true, name: true },
      take: 5,
    });
    if (candidates.length === 0) return null;
    // Если несколько — берём с наиболее точным совпадением (полное равенство).
    const exact = candidates.find((c) => c.name === cleaned);
    return (exact?.userId ?? candidates[0]?.userId ?? null) as string | null;
  }

  /**
   * Static-проверка traitType (для unit-тестов). Публичный для unit-test'ов.
   */
  static isValidTraitType(value: unknown): value is HelpfulnessTraitType {
    if (typeof value !== 'string') return false;
    return (ALLOWED_TRAIT_TYPES as readonly string[]).includes(value);
  }

  /**
   * Static-helper: определяет visibility по traitType. Используется
   * worker'ом и unit-тестами на этическую защиту.
   */
  static defaultVisibilityFor(
    traitType: HelpfulnessTraitType,
  ): 'public_team' | 'internal' | 'restricted' {
    return PRIVATE_TRAIT_TYPES.has(traitType) ? 'restricted' : 'internal';
  }
}
