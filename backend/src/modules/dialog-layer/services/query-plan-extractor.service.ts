import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { $Enums } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { sanitizeCustomPrompt } from '../../ai/services/prompts/sanitize-custom-prompt';
import { EntityResolutionService } from '../../knowledge-core/services/entity-resolution.service';
import {
  EXTRACT_PLAN_JSON_SCHEMA,
  EXTRACT_PLAN_SYSTEM_PROMPT,
  buildExtractPlanUserPrompt,
} from '../prompts/extract-plan.prompt';
import {
  DIALOG_UNDERSTAND_JSON_SCHEMA,
  DIALOG_UNDERSTAND_SYSTEM_PROMPT,
  buildUnderstandUserPrompt,
} from '../prompts/understand.prompt';

import { detectPeriodExpr, type PeriodExpr, resolvePeriod } from './period-resolver';
import { classifyQueryClass, isQueryClass, type QueryClass } from './query-classifier.service';

export interface QueryPlanFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];
  themeBranches: string[];
  entityHints: string[];
  personHints: string[];
  personScope: boolean;
  aggregation: boolean;
  needsAction: boolean;
  activeNow: boolean;
}

export interface StructuralRetrievalFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];
  entityIds: string[];
  personIds: string[];
  themeBranches: string[];
  bitemporalActiveOnly: boolean;
}

/**
 * Слой источника Ф4 (R14) — сигнал настоящей неоднозначности имени в К1.
 * Возникает, когда подсказка-имя дала ≥2 равноуверенных кандидата И контекст-
 * сущность не сузила выбор до одного. Помощник короткозамыкает на уточняющий
 * вопрос (свободный текст), не подставляя personIds вслепую.
 */
export interface StructuralFilterClarification {
  question: string;
  hint: string;
  candidatePersonIds: string[];
}

export interface ResolvedStructuralFilters {
  filters: StructuralRetrievalFilters | null;
  clarification: StructuralFilterClarification | null;
}

export interface QueryPlanResult {
  filters: QueryPlanFilters;
  queryClass: QueryClass;
  queryClassConfidence: number;
  confidence: number;
  applied: boolean;
  durationSeconds: number;
}

export interface QueryPlanExtractInput {
  tenantId: string;
  userId: string;
  questions: string[];
  todayIso: string;
  orgTimezone: string | null;
  conversationId: string | null;
}

export interface UnderstandInput {
  tenantId: string;
  userId: string;
  question: string;
  summary: string | null;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  todayIso: string;
  orgTimezone: string | null;
  conversationId: string | null;
}

export interface UnderstandResult {
  queries: string[];
  queryPlan: QueryPlanResult;
}

export const QUERY_PLAN_MIN_CONFIDENCE = 0.6;

const QUERY_CLASS_TIEBREAK_FLOOR = 0.7;

const ENTITY_HINT_MAX_LENGTH = 200;
const ENTITY_HINT_MAX_COUNT = 10;

interface RawPlan {
  periodExpr?: unknown;
  periodDays?: unknown;
  signalTypes?: unknown;
  themeBranches?: unknown;
  entityHints?: unknown;
  personHints?: unknown;
  queryClass?: unknown;
  personScope?: unknown;
  aggregation?: unknown;
  needsAction?: unknown;
  activeNow?: unknown;
  confidence?: unknown;
}

const VALID_PERIOD_EXPRS: ReadonlySet<PeriodExpr> = new Set<PeriodExpr>([
  'this_week',
  'last_week',
  'yesterday',
  'today',
  'this_month',
  'last_month',
  'last_n_days',
  'none',
]);

@Injectable()
export class QueryPlanExtractorService {
  private readonly logger = new Logger(QueryPlanExtractorService.name);

  private readonly validSignalTypes = new Set<string>(Object.values($Enums.SignalType));
  private readonly validThemeBranches = new Set<string>(Object.values($Enums.ThemeBranch));

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(EntityResolutionService)
    private readonly entityResolution?: EntityResolutionService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async understand(input: UnderstandInput): Promise<UnderstandResult> {
    const startedAt = Date.now();
    const orgTimezone = input.orgTimezone ?? 'Europe/Moscow';

    let rawText: string;
    try {
      const guardOn = this.isPromptInjectionGuardEnabled();
      if (guardOn) {
        const sanitized = sanitizeCustomPrompt(input.question);
        for (const pattern of sanitized.reasons) {
          this.metrics.incPromptInjectionAttempt({ source: 'chat', pattern });
        }
      }
      const knownNames = await this.resolveGroundingHints(
        input.tenantId,
        input.question,
      );
      const rawUser = buildUnderstandUserPrompt({
        summary: input.summary,
        history: input.history,
        question: input.question,
        todayIso: input.todayIso,
        orgTimezone,
        knownNames,
      });
      const systemPrompt = guardOn
        ? withInjectionGuard(DIALOG_UNDERSTAND_SYSTEM_PROMPT)
        : DIALOG_UNDERSTAND_SYSTEM_PROMPT;
      const userMessage = guardOn ? wrapUserData(rawUser) : rawUser;

      const result = await this.llm.call({
        taskType: 'dialog-understand',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt,
        userMessage,
        maxTokens: 1500,
        responseFormat: {
          type: 'json_schema',
          name: 'dialog_understand_v1',
          strict: true,
          schema: DIALOG_UNDERSTAND_JSON_SCHEMA,
        },
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      rawText = result.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'Understand LLM упал — fail-open (только оригинальный вопрос, без плана)',
      );
      return {
        queries: [input.question],
        queryPlan: this.failOpen(startedAt, input.question),
      };
    }

    const parsed = this.parseUnderstandJson(rawText);
    if (parsed === null) {
      this.metrics.incPromptInvalidResponse({
        taskType: 'dialog-understand',
        model: 'unknown',
        reason: 'json_parse',
      });
      return {
        queries: [input.question],
        queryPlan: this.failOpen(startedAt, input.question),
      };
    }

    const deterministicPeriod =
      (await this.cfg
        .getDynamic<boolean>('knowledge.chatV2DeterministicPeriod', undefined, true)
        .catch(() => true)) ?? true;

    const queries = this.buildQueries(input.question, parsed.queries);
    const queryPlan = this.buildPlanFromRaw(
      parsed.plan,
      parsed.confidence,
      input.todayIso,
      orgTimezone,
      startedAt,
      input.question,
      deterministicPeriod,
    );
    return { queries, queryPlan };
  }

  async extract(input: QueryPlanExtractInput): Promise<QueryPlanResult> {
    const startedAt = Date.now();
    const orgTimezone = input.orgTimezone ?? 'Europe/Moscow';

    let rawText: string;
    try {
      const rawUser = buildExtractPlanUserPrompt({
        questions: input.questions,
        todayIso: input.todayIso,
        orgTimezone,
      });
      const systemPrompt = withInjectionGuard(EXTRACT_PLAN_SYSTEM_PROMPT);
      const userMessage = wrapUserData(rawUser);

      const result = await this.llm.call({
        taskType: 'dialog-extract-plan',
        tenantId: input.tenantId,
        userId: input.userId,
        systemPrompt,
        userMessage,
        maxTokens: 800,
        responseFormat: {
          type: 'json_schema',
          name: 'dialog_extract_plan_v2',
          strict: true,
          schema: EXTRACT_PLAN_JSON_SCHEMA,
        },
        sourceRef: input.conversationId
          ? { type: 'chat_v2_conversation', id: input.conversationId }
          : null,
      });
      rawText = result.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { conversationId: input.conversationId, err: message },
        'QueryPlanExtractor LLM упал — fail-open (план не применяется)',
      );
      return this.failOpen(startedAt, input.questions.join(' '));
    }

    const parsed = this.parsePlanJson(rawText);
    if (parsed === null) {
      return this.failOpen(startedAt, input.questions.join(' '));
    }

    const deterministicPeriod =
      (await this.cfg
        .getDynamic<boolean>('knowledge.chatV2DeterministicPeriod', undefined, true)
        .catch(() => true)) ?? true;

    return this.buildPlanFromRaw(
      parsed,
      this.coerceConfidence(parsed.confidence),
      input.todayIso,
      orgTimezone,
      startedAt,
      input.questions.join(' '),
      deterministicPeriod,
    );
  }

  private resolveQueryClass(
    raw: RawPlan,
    question: string,
  ): { queryClass: QueryClass; queryClassConfidence: number } {
    const deterministic = classifyQueryClass(question);
    if (deterministic.confidence >= QUERY_CLASS_TIEBREAK_FLOOR) {
      return {
        queryClass: deterministic.class,
        queryClassConfidence: deterministic.confidence,
      };
    }
    if (isQueryClass(raw.queryClass)) {
      return { queryClass: raw.queryClass, queryClassConfidence: 0.6 };
    }
    return {
      queryClass: deterministic.class,
      queryClassConfidence: deterministic.confidence,
    };
  }

  private buildPlanFromRaw(
    raw: RawPlan,
    confidence: number,
    todayIso: string,
    orgTimezone: string,
    startedAt: number,
    question: string,
    deterministicPeriod: boolean,
  ): QueryPlanResult {
    let periodExpr = this.coercePeriodExpr(raw.periodExpr);
    let periodDays = this.coercePeriodDays(raw.periodDays);
    let effectiveConfidence = confidence;

    if (deterministicPeriod) {
      const det = detectPeriodExpr(question);
      if (det.expr !== 'none') {
        periodExpr = det.expr;
        if (det.expr === 'last_n_days' && det.periodDays != null) {
          periodDays = det.periodDays;
        }
        effectiveConfidence = Math.max(effectiveConfidence, QUERY_PLAN_MIN_CONFIDENCE);
      }
    }

    const signalTypes = this.sanitizeEnumArray(raw.signalTypes, this.validSignalTypes);
    const themeBranches = this.sanitizeEnumArray(raw.themeBranches, this.validThemeBranches);
    const entityHints = this.sanitizeEntityHints(raw.entityHints);
    const personHints = this.sanitizeEntityHints(raw.personHints);
    const personScope = this.coerceBool(raw.personScope);
    const aggregation = this.coerceBool(raw.aggregation);
    const needsAction = this.coerceBool(raw.needsAction);
    const activeNow = this.coerceBool(raw.activeNow);

    const { queryClass, queryClassConfidence } = this.resolveQueryClass(raw, question);

    const period = resolvePeriod(periodExpr, todayIso, orgTimezone, periodDays);

    const hasAnyFilter =
      !!(period.dateFrom || period.dateTo) ||
      signalTypes.length > 0 ||
      themeBranches.length > 0 ||
      entityHints.length > 0 ||
      personHints.length > 0 ||
      personScope ||
      activeNow;

    const applied = hasAnyFilter && effectiveConfidence >= QUERY_PLAN_MIN_CONFIDENCE;
    const durationSeconds = (Date.now() - startedAt) / 1000;

    if (!applied) {
      return {
        filters: this.emptyFilters(),
        queryClass,
        queryClassConfidence,
        confidence: effectiveConfidence,
        applied: false,
        durationSeconds,
      };
    }

    return {
      filters: {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
        signalTypes,
        themeBranches,
        entityHints,
        personHints,
        personScope,
        aggregation,
        needsAction,
        activeNow,
      },
      queryClass,
      queryClassConfidence,
      confidence: effectiveConfidence,
      applied: true,
      durationSeconds,
    };
  }

  private buildQueries(question: string, rawQueries: unknown): string[] {
    const expansions = Array.isArray(rawQueries)
      ? rawQueries
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .slice(0, 3)
      : [];
    const seen = new Set<string>();
    return [question, ...expansions]
      .map((q) => q.trim())
      .filter((q) => {
        if (q.length === 0) return false;
        const k = q.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 3);
  }

  private parseUnderstandJson(
    text: string,
  ): { queries: unknown; plan: RawPlan; confidence: number } | null {
    try {
      const cleaned = this.stripCodeFence(text).trim();
      const parsed = JSON.parse(cleaned) as unknown;
      if (parsed === null || typeof parsed !== 'object') return null;
      const obj = parsed as { queries?: unknown; plan?: unknown; confidence?: unknown };
      const plan =
        obj.plan !== null && typeof obj.plan === 'object' ? (obj.plan as RawPlan) : {};
      return {
        queries: obj.queries,
        plan,
        confidence: this.coerceConfidence(obj.confidence),
      };
    } catch {
      return null;
    }
  }

  async resolveSelfPersonId(tenantId: string, userId: string): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    return person?.id ?? null;
  }

  async resolveStructuralFilters(args: {
    tenantId: string;
    userId: string;
    plan: QueryPlanResult;
  }): Promise<StructuralRetrievalFilters | null> {
    const { tenantId, userId, plan } = args;
    if (!plan.applied) return null;

    try {
      const entityIds = await this.resolveEntityHints(tenantId, plan.filters.entityHints);

      if (plan.filters.personScope) {
        const selfEntityId = await this.resolveSelfEntityId(tenantId, userId);
        if (selfEntityId && !entityIds.includes(selfEntityId)) {
          entityIds.push(selfEntityId);
        }
      }

      const personIds = await this.resolvePersonHints(tenantId, [
        ...plan.filters.personHints,
        ...plan.filters.entityHints,
      ]);
      if (plan.filters.personScope) {
        const selfPersonId = await this.resolveSelfPersonId(tenantId, userId);
        if (selfPersonId && !personIds.includes(selfPersonId)) {
          personIds.push(selfPersonId);
        }
      }

      const filters: StructuralRetrievalFilters = {
        dateFrom: plan.filters.dateFrom,
        dateTo: plan.filters.dateTo,
        signalTypes: plan.filters.signalTypes,
        entityIds,
        personIds,
        themeBranches: plan.filters.themeBranches,
        bitemporalActiveOnly: plan.filters.activeNow,
      };

      const nothingToFilter =
        !filters.dateFrom &&
        !filters.dateTo &&
        filters.signalTypes.length === 0 &&
        filters.entityIds.length === 0 &&
        filters.personIds.length === 0 &&
        filters.themeBranches.length === 0 &&
        !filters.bitemporalActiveOnly;
      if (nothingToFilter) return null;

      return filters;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { tenantId, err: message },
        'resolveStructuralFilters упал — fail-open (без структурного фильтра)',
      );
      return null;
    }
  }

  /**
   * Слой источника Ф4 (R14) — резолв структурных фильтров с детектом настоящей
   * неоднозначности имени для маршрута К1 (class='list'). Имена-подсказки
   * резолвятся через нечёткий `resolvePersonCandidates` (НЕ точное равенство):
   *   - единственный уверенный кандидат / контекст сузил → personIds, как обычно;
   *   - ≥2 кандидата с близкой уверенностью (дельта < knowledge.
   *     person_resolve_ambiguity_delta) И контекст-сущность не сузила до одного
   *     → clarification (свободный вопрос), personIds НЕ подставляются.
   * Остальные оси (дата/тип/тема/сущности) — как в resolveStructuralFilters.
   * Fail-open: при сбое — без фильтра и без clarification.
   */
  async resolveStructuralFiltersWithClarify(args: {
    tenantId: string;
    userId: string;
    plan: QueryPlanResult;
  }): Promise<ResolvedStructuralFilters> {
    const { tenantId, userId, plan } = args;
    if (!plan.applied) return { filters: null, clarification: null };

    try {
      const entityIds = await this.resolveEntityHints(tenantId, plan.filters.entityHints);

      if (plan.filters.personScope) {
        const selfEntityId = await this.resolveSelfEntityId(tenantId, userId);
        if (selfEntityId && !entityIds.includes(selfEntityId)) {
          entityIds.push(selfEntityId);
        }
      }

      const isList = plan.queryClass === 'list';
      const isFactOrTopic =
        plan.queryClass === 'fact' || plan.queryClass === 'topic';
      const personHints = [
        ...plan.filters.personHints,
        ...plan.filters.entityHints,
      ];

      const { personIds, clarification } = isList
        ? await this.resolvePersonHintsWithClarify(tenantId, personHints, entityIds)
        : isFactOrTopic
          ? {
              personIds: await this.resolvePersonHints(tenantId, personHints),
              clarification: null,
            }
          : { personIds: [] as string[], clarification: null };

      if (clarification) {
        return { filters: null, clarification };
      }

      if (plan.filters.personScope) {
        const selfPersonId = await this.resolveSelfPersonId(tenantId, userId);
        if (selfPersonId && !personIds.includes(selfPersonId)) {
          personIds.push(selfPersonId);
        }
      }

      const filters: StructuralRetrievalFilters = {
        dateFrom: plan.filters.dateFrom,
        dateTo: plan.filters.dateTo,
        signalTypes: plan.filters.signalTypes,
        entityIds,
        personIds,
        themeBranches: plan.filters.themeBranches,
        bitemporalActiveOnly: plan.filters.activeNow,
      };

      const nothingToFilter =
        !filters.dateFrom &&
        !filters.dateTo &&
        filters.signalTypes.length === 0 &&
        filters.entityIds.length === 0 &&
        filters.personIds.length === 0 &&
        filters.themeBranches.length === 0 &&
        !filters.bitemporalActiveOnly;
      if (nothingToFilter) return { filters: null, clarification: null };

      return { filters, clarification: null };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { tenantId, err: message },
        'resolveStructuralFiltersWithClarify упал — fail-open (без фильтра и без уточнения)',
      );
      return { filters: null, clarification: null };
    }
  }

  /**
   * Слой источника Ф4 (R14) — резолв имён-подсказок в personIds с детектом
   * неоднозначности. На каждую уникальную подсказку берёт ранжированных
   * кандидатов (`resolvePersonCandidates`, контекст-сущности сужают):
   *   - 0 кандидатов → пропуск (семантическая страховка позже);
   *   - 1 кандидат → personId;
   *   - ≥2 кандидата, дельта top1−top2 < delta → clarification (короткое замыкание);
   *   - ≥2 кандидата, дельта ≥ delta → берём top1 (контекст/уверенность развели).
   * Первая встреченная неоднозначность возвращается как clarification.
   */
  private async resolvePersonHintsWithClarify(
    tenantId: string,
    hints: string[],
    contextEntityIds: string[],
  ): Promise<{
    personIds: string[];
    clarification: StructuralFilterClarification | null;
  }> {
    if (!this.entityResolution) return { personIds: [], clarification: null };

    const delta =
      (await this.cfg
        .getDynamic<number>('knowledge.person_resolve_ambiguity_delta', undefined, 0.1)
        .catch(() => 0.1)) ?? 0.1;

    const out: string[] = [];
    const seen = new Set<string>();
    const seenHints = new Set<string>();

    for (const rawHint of hints) {
      const hint = rawHint.trim();
      if (!hint) continue;
      const hintKey = hint.toLowerCase();
      if (seenHints.has(hintKey)) continue;
      seenHints.add(hintKey);

      const candidates = await this.entityResolution
        .resolvePersonCandidates({ tenantId, hint, contextEntityIds })
        .catch(() => [] as Array<{ personId: string; confidence: number }>);

      if (candidates.length === 0) continue;

      const top = candidates[0]!;
      const second = candidates[1];
      const ambiguous =
        candidates.length >= 2 &&
        second !== undefined &&
        top.confidence - second.confidence < delta;

      if (ambiguous) {
        return {
          personIds: [],
          clarification: {
            question: `Уточните, пожалуйста: про какого «${hint}» речь? В памяти есть несколько разных людей с таким именем. Подскажите компанию, отдел или о чём была встреча — и я найду нужные источники.`,
            hint,
            candidatePersonIds: candidates.map((c) => c.personId),
          },
        };
      }

      if (seen.has(top.personId)) continue;
      seen.add(top.personId);
      out.push(top.personId);
      if (out.length >= ENTITY_HINT_MAX_COUNT) break;
    }

    return { personIds: out, clarification: null };
  }

  private async resolveGroundingHints(
    tenantId: string,
    question: string,
  ): Promise<string[]> {
    try {
      const enabled = await this.cfg.getDynamic<boolean>(
        'knowledge.chatV2UnderstandGrounding',
        undefined,
        true,
      );
      if (!enabled) return [];
      const topK = await this.cfg.getDynamic<number>(
        'knowledge.chatV2GroundingTopK',
        undefined,
        15,
      );
      const embeddingEnabled = await this.cfg.getDynamic<boolean>(
        'knowledge.chatV2GroundingEmbedding',
        undefined,
        true,
      );
      const embeddingTopK = await this.cfg.getDynamic<number>(
        'knowledge.chatV2GroundingEmbeddingTopK',
        undefined,
        10,
      );
      const embeddingMinSim = await this.cfg.getDynamic<number>(
        'knowledge.chatV2GroundingEmbeddingMinSim',
        undefined,
        0.35,
      );
      const tokens = [
        ...new Set(
          question
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .map((t) => t.trim())
            .filter((t) => t.length >= 4),
        ),
      ].slice(0, 12);

      const [entities, themes] =
        tokens.length === 0
          ? [[], []]
          : await Promise.all([
              this.prisma.entity.findMany({
                where: {
                  tenantId,
                  mergedIntoId: null,
                  OR: [
                    ...tokens.map((t) => ({
                      canonicalName: { contains: t, mode: 'insensitive' as const },
                    })),
                    { aliases: { hasSome: tokens } },
                  ],
                },
                select: { canonicalName: true },
                take: topK * 2,
              }),
              this.prisma.theme.findMany({
                where: {
                  tenantId,
                  status: 'active',
                  OR: tokens.map((t) => ({
                    name: { contains: t, mode: 'insensitive' as const },
                  })),
                },
                select: { name: true },
                take: topK,
              }),
            ]);

      const out: string[] = [];
      const seen = new Set<string>();
      for (const name of [
        ...entities.map((e) => e.canonicalName),
        ...themes.map((t) => t.name),
      ]) {
        const trimmed = name?.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(trimmed);
      }

      let embeddingHints: string[] = [];
      if (embeddingEnabled && this.entityResolution) {
        try {
          embeddingHints = await this.entityResolution.resolveEntityHintsByEmbedding(
            tenantId,
            question,
            embeddingTopK,
            embeddingMinSim,
          );
        } catch {
          embeddingHints = [];
        }
      }

      const embeddingKeys = new Set<string>();
      for (const name of embeddingHints) {
        const trimmed = name?.trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        embeddingKeys.add(key);
        out.push(trimmed);
      }

      const capped = out.slice(0, topK);
      let survived = 0;
      for (const name of capped) {
        if (embeddingKeys.has(name.toLowerCase())) survived += 1;
      }
      if (survived > 0) {
        this.metrics.incChatV2GroundingEmbeddingHits(survived);
      }

      return capped;
    } catch (err) {
      this.logger.warn(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'resolveGroundingHints упал — fail-open (справочник пуст)',
      );
      return [];
    }
  }

  private async resolveEntityHints(tenantId: string, hints: string[]): Promise<string[]> {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rawHint of hints) {
      const hint = rawHint.trim();
      if (!hint) continue;
      const entity = await this.prisma.entity.findFirst({
        where: {
          tenantId,
          mergedIntoId: null,
          OR: [
            { canonicalName: { equals: hint, mode: 'insensitive' } },
            { aliases: { has: hint } },
          ],
        },
        select: { id: true },
      });
      if (!entity) continue;
      if (seen.has(entity.id)) continue;
      seen.add(entity.id);
      out.push(entity.id);
      if (out.length >= ENTITY_HINT_MAX_COUNT) break;
    }
    return out;
  }

  private async resolvePersonHints(tenantId: string, hints: string[]): Promise<string[]> {
    if (!this.entityResolution) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    const seenHints = new Set<string>();
    for (const rawHint of hints) {
      const hint = rawHint.trim();
      if (!hint) continue;
      const hintKey = hint.toLowerCase();
      if (seenHints.has(hintKey)) continue;
      seenHints.add(hintKey);
      const personId = await this.entityResolution
        .resolvePersonByHint(tenantId, hint)
        .catch(() => null);
      if (!personId) continue;
      if (seen.has(personId)) continue;
      seen.add(personId);
      out.push(personId);
      if (out.length >= ENTITY_HINT_MAX_COUNT) break;
    }
    return out;
  }

  private async resolveSelfEntityId(tenantId: string, userId: string): Promise<string | null> {
    const person = await this.prisma.person.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { entityId: true },
    });
    return person?.entityId ?? null;
  }

  private emptyFilters(): QueryPlanFilters {
    return {
      dateFrom: null,
      dateTo: null,
      signalTypes: [],
      themeBranches: [],
      entityHints: [],
      personHints: [],
      personScope: false,
      aggregation: false,
      needsAction: false,
      activeNow: false,
    };
  }

  private failOpen(startedAt: number, question?: string): QueryPlanResult {
    const deterministic = classifyQueryClass(question ?? '');
    return {
      filters: this.emptyFilters(),
      queryClass: deterministic.class,
      queryClassConfidence: deterministic.confidence,
      confidence: 0,
      applied: false,
      durationSeconds: (Date.now() - startedAt) / 1000,
    };
  }

  private parsePlanJson(text: string): RawPlan | null {
    try {
      const cleaned = this.stripCodeFence(text).trim();
      const parsed = JSON.parse(cleaned) as unknown;
      if (parsed === null || typeof parsed !== 'object') return null;
      return parsed as RawPlan;
    } catch {
      return null;
    }
  }

  private stripCodeFence(s: string): string {
    return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }

  private coercePeriodExpr(raw: unknown): PeriodExpr {
    if (typeof raw === 'string' && VALID_PERIOD_EXPRS.has(raw as PeriodExpr)) {
      return raw as PeriodExpr;
    }
    return 'none';
  }

  private coercePeriodDays(raw: unknown): number | null {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return Math.floor(raw);
    }
    return null;
  }

  private sanitizeEnumArray(raw: unknown, valid: ReadonlySet<string>): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      if (!valid.has(v)) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  private sanitizeEntityHints(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const trimmed = v.trim().slice(0, ENTITY_HINT_MAX_LENGTH);
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= ENTITY_HINT_MAX_COUNT) break;
    }
    return out;
  }

  private coerceBool(raw: unknown): boolean {
    return raw === true;
  }

  private coerceConfidence(raw: unknown): number {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return Math.max(0, Math.min(1, raw));
    }
    return 0;
  }
}
