/**
 * SpecialistsCombinedService — ТЗ 2026-05-25 llm-architecture-changes §3
 * (Variant Б+).
 *
 * Заменяет 8 раздельных вызовов специалистов 3-1..3-9 ОДНИМ объединённым
 * LLM-вызовом на все блоки одной встречи. Эксперимент показал: 18:13 по
 * качеству судьи vs Variant Г (8 раздельных) при 3.7× меньшей стоимости и
 * том же числе сущностей (41 шт).
 *
 * Стратегия rollout (см. RouterSchema.SPECIALISTS_COMBINED_ENABLED):
 *   - default `false` — старые специалисты работают как сейчас.
 *   - `true` — параллельно со старыми запускается этот сервис. Старые НЕ
 *     отключаются: сначала проверяем дубли/качество на проде, потом удаляем
 *     старых отдельным шагом.
 *
 * Сохранение сущностей. На MVP — простой write через `prisma.$transaction`:
 *   - decisions   → `prisma.decision.create` (без KNN-dedup, без supersede-detect)
 *   - ideas       → `prisma.idea.create`
 *   - insights    → `prisma.insight.create`
 *   - experiments → `prisma.experiment.create`
 *   - regulations → `prisma.regulation.upsert` (по tenantId+name — уникально)
 *   - knowledge_categories → `prisma.personKnowledgeCategoryEmbedding.create`
 *     (без embedding — построится в γ-фазе при необходимости)
 *   - skill_traits → `prisma.skillTrait.create` (поверх SkillProfile,
 *     создаём профиль если нет)
 *   - helpfulness_traits → `prisma.helpfulnessTrait.create`
 *
 * НЕ дублирует логику dedup/triage/probe старых специалистов: это MVP-вариант,
 * на проде смотрим на качество — если дубли мешают, добавим merge-арбитр
 * следующей волной.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type IdeaKind,
  type InsightKind,
  type InsightSeverity,
  Prisma,
  type SkillConfidence,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  buildSpecialistsCombinedSystemPrompt,
  buildSpecialistsCombinedUserMessage,
  type CombinedInputBlock,
  type SpecialistsCombinedOutput,
  SPECIALISTS_COMBINED_MAX_TOKENS,
  SPECIALISTS_COMBINED_TASK_TYPE,
  SPECIALISTS_COMBINED_TOOL_NAME,
  SpecialistsCombinedOutputSchema,
  SUBMIT_ALL_8_ENTITIES_TOOL,
} from '../prompts/specialists-combined.prompt';

/**
 * Аргументы `extractAll`. `meetingTitle` опц. — если не передан, генерируется
 * placeholder вида `meeting:<meetingId>`.
 */
export interface SpecialistsCombinedExtractArgs {
  tenantId: string;
  meetingId: string;
  meetingTitle?: string;
  blocks: CombinedInputBlock[];
  /** Если задан — пробрасывается в LlmRouter для drill-down аудита. */
  jobId?: string;
  /** dataClass пакета (max по blocks). Default 'internal'. */
  dataClass?: DataClass;
}

/**
 * Результат `extractAll` (для логов / метрик / тестов).
 */
export interface SpecialistsCombinedExtractResult {
  /** Сколько сущностей каждого типа было создано фактически (post-persist). */
  created: {
    decisions: number;
    ideas: number;
    insights: number;
    experiments: number;
    regulations: number;
    /** A12 (Волна 6) — инструкции (kind='instruction' в regulations[]). */
    instructions: number;
    knowledgeCategories: number;
    skillTraits: number;
    helpfulnessTraits: number;
  };
  /** Какие parsed-payload-секции были пустые (для диагностики промпта). */
  emptySections: string[];
  /** Метаданные LLM-вызова. */
  llm: {
    modelUsed: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  };
  /** Ошибки при сохранении (best-effort, не блокируют остальные типы). */
  errors: string[];
}

/**
 * Доменная ошибка: модель не вернула tool_call или вернула невалидный JSON.
 * Бросается из `extractAll`; worker должен показать failed-статус и не
 * ретраить бесконечно.
 */
export class SpecialistsCombinedParseError extends Error {
  constructor(
    message: string,
    readonly rawText?: string,
  ) {
    super(message);
    this.name = 'SpecialistsCombinedParseError';
  }
}

@Injectable()
export class SpecialistsCombinedService {
  private readonly logger = new Logger(SpecialistsCombinedService.name);

  static readonly METRIC_TYPE = 'combined';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * Основной публичный метод. Один LLM-вызов на ВСЕ blocks встречи + persist
   * восьми типов сущностей. Best-effort: ошибка одного типа не блокирует
   * остальные.
   */
  async extractAll(
    args: SpecialistsCombinedExtractArgs,
  ): Promise<SpecialistsCombinedExtractResult> {
    if (args.blocks.length === 0) {
      this.logger.debug(
        { meetingId: args.meetingId, tenantId: args.tenantId },
        'specialists-combined: пустой список блоков — skip',
      );
      return this.emptyResult({
        modelUsed: 'noop',
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
      });
    }

    // ── 1. LLM-вызов ──
    const systemPrompt = buildSpecialistsCombinedSystemPrompt();
    const userMessage = buildSpecialistsCombinedUserMessage({
      meetingTitle: args.meetingTitle ?? `meeting:${args.meetingId}`,
      blocks: args.blocks,
    });

    const startedAt = Date.now();
    const result = await this.llm.call({
      taskType: SPECIALISTS_COMBINED_TASK_TYPE,
      systemPrompt,
      userMessage,
      tenantId: args.tenantId,
      meetingId: args.meetingId,
      ...(args.jobId ? { jobId: args.jobId } : {}),
      maxTokens: SPECIALISTS_COMBINED_MAX_TOKENS,
      tools: [SUBMIT_ALL_8_ENTITIES_TOOL],
      sourceRef: { type: 'meeting', id: args.meetingId },
      dataClass: args.dataClass ?? 'internal',
    });

    // ── 2. Парсинг tool_call ──
    const parsed = this.parseToolCallOutput(result.toolCalls, result.text);

    // ── 3. Persist (best-effort по типу) ──
    const errors: string[] = [];
    const created = {
      decisions: 0,
      ideas: 0,
      insights: 0,
      experiments: 0,
      regulations: 0,
      instructions: 0,
      knowledgeCategories: 0,
      skillTraits: 0,
      helpfulnessTraits: 0,
    };

    const blockIdSet = new Set(args.blocks.map((b) => b.id));

    created.decisions = await this.persistDecisions(args.tenantId, parsed, blockIdSet, errors);
    created.ideas = await this.persistIdeas(args.tenantId, parsed, blockIdSet, errors);
    created.insights = await this.persistInsights(args.tenantId, parsed, blockIdSet, errors);
    created.experiments = await this.persistExperiments(args.tenantId, parsed, blockIdSet, errors);
    created.regulations = await this.persistRegulations(args.tenantId, parsed, blockIdSet, errors);
    created.instructions = await this.persistInstructions(args.tenantId, parsed, blockIdSet, errors);
    created.knowledgeCategories = await this.persistKnowledgeCategories(args.tenantId, parsed, errors);
    created.skillTraits = await this.persistSkillTraits(args.tenantId, parsed, errors);
    created.helpfulnessTraits = await this.persistHelpfulness(args.tenantId, parsed, blockIdSet, errors);

    // ── 4. Метрики ──
    this.recordMetrics(created, result);

    const emptySections: string[] = [];
    if (parsed.decisions.length === 0) emptySections.push('decisions');
    if (parsed.ideas.length === 0) emptySections.push('ideas');
    if (parsed.insights.length === 0) emptySections.push('insights');
    if (parsed.experiments.length === 0) emptySections.push('experiments');
    if (parsed.regulations.length === 0) emptySections.push('regulations');
    if (parsed.knowledge_categories.length === 0) emptySections.push('knowledge_categories');
    if (parsed.skill_traits.length === 0) emptySections.push('skill_traits');
    if (parsed.helpfulness_traits.length === 0) emptySections.push('helpfulness_traits');

    return {
      created,
      emptySections,
      llm: {
        modelUsed: result.modelUsed,
        durationMs: Date.now() - startedAt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens,
      },
      errors,
    };
  }

  // ─────────────────────── parse helpers ───────────────────────

  private parseToolCallOutput(
    toolCalls: Array<{ name: string; input: unknown }> | undefined,
    fallbackText: string,
  ): SpecialistsCombinedOutput {
    let rawInput: unknown = null;

    if (toolCalls && toolCalls.length > 0) {
      const direct = toolCalls.find(
        (tc) => tc.name === SPECIALISTS_COMBINED_TOOL_NAME,
      );
      rawInput = (direct ?? toolCalls[0])?.input ?? null;
    }

    // Fallback — некоторые провайдеры возвращают строку, другие сразу объект.
    if (rawInput === null && fallbackText) {
      try {
        rawInput = JSON.parse(fallbackText);
      } catch {
        // ignore — упадём ниже на schema-валидации.
      }
    }

    if (rawInput === null) {
      throw new SpecialistsCombinedParseError(
        `LLM не вернул tool_calls (${SPECIALISTS_COMBINED_TOOL_NAME}) и не вернул валидный JSON в text`,
        fallbackText,
      );
    }

    // Если LLM сериализовал arguments как строку — пробуем распарсить.
    if (typeof rawInput === 'string') {
      try {
        rawInput = JSON.parse(rawInput);
      } catch (err) {
        throw new SpecialistsCombinedParseError(
          `LLM вернул tool_call с невалидным JSON в arguments: ${
            err instanceof Error ? err.message : String(err)
          }`,
          fallbackText,
        );
      }
    }

    const validated = SpecialistsCombinedOutputSchema.safeParse(rawInput);
    if (!validated.success) {
      throw new SpecialistsCombinedParseError(
        `LLM-output не прошёл zod-валидацию: ${validated.error.message}`,
        fallbackText,
      );
    }
    return validated.data;
  }

  // ─────────────────────── persist: decisions ──────────────────

  private async persistDecisions(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const d of parsed.decisions) {
      if (!blockIdSet.has(d.sourceBlockId)) {
        this.logger.debug(
          { sourceBlockId: d.sourceBlockId },
          'specialists-combined.decisions: sourceBlockId не найден в наборе блоков встречи — skip',
        );
        continue;
      }
      try {
        await this.prisma.decision.create({
          data: {
            tenantId,
            text: d.statement.slice(0, 1_000),
            statement: d.statement,
            rationale: d.rationale ?? null,
            alternatives:
              d.alternatives && d.alternatives.length > 0
                ? (d.alternatives as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            sourceBlockIds: [d.sourceBlockId],
            sourceIdeaBlockId: d.sourceBlockId,
            status: (d.status ?? 'approved') as
              | 'proposed'
              | 'approved'
              | 'rejected'
              | 'implemented',
            confidence: new Prisma.Decimal(this.clamp01(d.confidence)),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`decision[${d.sourceBlockId}]: ${msg}`);
        this.logger.warn(
          { sourceBlockId: d.sourceBlockId, err: msg },
          'specialists-combined.decisions: persist упал — продолжаем',
        );
      }
    }
    return created;
  }

  // ─────────────────────── persist: ideas ──────────────────────

  private async persistIdeas(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const i of parsed.ideas) {
      if (!blockIdSet.has(i.sourceBlockId)) continue;
      try {
        await this.prisma.idea.create({
          data: {
            tenantId,
            kind: i.kind as IdeaKind,
            statement: i.statement,
            rationale: i.rationale ?? null,
            sourceBlockIds: [i.sourceBlockId],
            confidence: new Prisma.Decimal(this.clamp01(i.confidence)),
            supporters: [] as unknown as Prisma.InputJsonValue,
            supporterCount: 1,
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`idea[${i.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  // ─────────────────────── persist: insights ───────────────────

  private async persistInsights(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const it of parsed.insights) {
      if (!blockIdSet.has(it.sourceBlockId)) continue;
      try {
        await this.prisma.insight.create({
          data: {
            tenantId,
            kind: it.kind as InsightKind,
            statement: it.statement,
            severity: it.severity as InsightSeverity,
            sourceBlockIds: [it.sourceBlockId],
            mitigationPlan: it.mitigationSuggestion ?? null,
            causeCategory: it.causeCategory,
            confidence: new Prisma.Decimal(this.clamp01(it.confidence)),
            firstObservedAt: new Date(),
            lastObservedAt: new Date(),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`insight[${it.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  // ─────────────────────── persist: experiments ────────────────

  private async persistExperiments(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const e of parsed.experiments) {
      if (!blockIdSet.has(e.sourceBlockId)) continue;
      try {
        await this.prisma.experiment.create({
          data: {
            tenantId,
            name: e.name.slice(0, 120),
            hypothesisText: e.hypothesisText,
            status: e.status,
            currentResult: e.currentResult ?? null,
            lessonsJson:
              e.lessons && e.lessons.length > 0
                ? (e.lessons as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            sourceBlockIds: [e.sourceBlockId],
            confidence: new Prisma.Decimal(this.clamp01(e.confidence)),
            lastConfirmedAt: new Date(),
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`experiment[${e.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  // ─────────────────────── persist: regulations ────────────────

  private async persistRegulations(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const r of parsed.regulations) {
      if (!blockIdSet.has(r.sourceBlockId)) continue;
      // A12 (Волна 6) — инструкции едут в отдельную таблицу `instructions`
      // через persistInstructions. Здесь — только regulation/process/policy/
      // standard (process/policy сейчас тоже схлопываются в regulation, как и
      // раньше — это поведение НЕ меняем).
      if (r.kind === 'instruction') continue;
      // A2.2 (ТЗ 2026-06-11) — анти-плодёж гейт isOrgNorm (тот же смысл, что у
      // single-экстрактора): фрагмент с isOrgNorm=false (чужая практика /
      // гипотетика / разовое поручение) НЕ создаёт регламент. Исключение —
      // заявленная потребность (extractionStatus нужен/обсуждается). Kill-switch
      // regulationGateStrict (default ON); OFF → старое поведение.
      let gateStrict: boolean;
      try {
        gateStrict = this.cfg?.aiFeatures.regulationGateStrict !== false;
      } catch {
        gateStrict = true;
      }
      const isDeclaredNeed =
        r.extractionStatus === 'нужен' || r.extractionStatus === 'обсуждается';
      if (gateStrict && r.isOrgNorm === false && !isDeclaredNeed) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'regulation',
          reason: 'not_a_norm',
        });
        continue;
      }
      try {
        await this.prisma.regulation.upsert({
          where: {
            tenantId_name: { tenantId, name: r.name },
          },
          update: {
            statement: r.statement,
            sourceBlockIds: { push: r.sourceBlockId },
            confidence: r.confidence,
            category: r.kind === 'standard' ? 'standard' : 'regulation',
          },
          create: {
            tenantId,
            name: r.name,
            contentMd: r.statement,
            statement: r.statement,
            category: r.kind === 'standard' ? 'standard' : 'regulation',
            confidence: r.confidence,
            sourceBlockIds: [r.sourceBlockId],
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`regulation[${r.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  // ─────────────────────── persist: instructions (A12) ─────────
  //
  // Инструкции (kind='instruction' в regulations[]) — пошаговое «как сделать X»
  // для ОДНОЙ роли. Едут в отдельную таблицу `instructions` (не regulations).
  // Зеркалит persistRegulations по простоте: upsert по (tenantId, name), без
  // KNN-дедупа и triage (MVP, как у остальных типов в combined-сервисе).
  //   - extractionStatus → status: «существует»→active; иначе deprecated.
  //   - roles[0] → forRole (≤120 символов, лимит схемы).

  private async persistInstructions(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const r of parsed.regulations) {
      if (r.kind !== 'instruction') continue;
      if (!blockIdSet.has(r.sourceBlockId)) continue;
      const forRole =
        r.roles?.find((x) => x && x.trim().length > 0)?.trim().slice(0, 120) ??
        null;
      const status: 'active' | 'deprecated' =
        r.extractionStatus === 'нужен' || r.extractionStatus === 'обсуждается'
          ? 'deprecated'
          : 'active';
      try {
        await this.prisma.instruction.upsert({
          where: { tenantId_name: { tenantId, name: r.name } },
          update: {
            statement: r.statement,
            contentMd: r.statement,
            sourceBlockIds: { push: r.sourceBlockId },
            confidence: r.confidence,
            forRole: forRole ?? undefined,
            status,
          },
          create: {
            tenantId,
            name: r.name,
            contentMd: r.statement,
            statement: r.statement,
            confidence: r.confidence,
            forRole,
            status,
            sourceBlockIds: [r.sourceBlockId],
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`instruction[${r.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  // ─────────────────────── persist: knowledge_categories ───────

  private async persistKnowledgeCategories(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    errors: string[],
  ): Promise<number> {
    if (parsed.knowledge_categories.length === 0) return 0;

    // Резолвим personName → Person.id batch'ем (один запрос на всех).
    const names = Array.from(
      new Set(parsed.knowledge_categories.map((c) => c.personName.trim())),
    ).filter((n) => n.length > 0);
    if (names.length === 0) return 0;

    const persons = await this.prisma.person.findMany({
      where: { tenantId, name: { in: names }, deletedAt: null },
      select: { id: true, name: true, profileBuildVersion: true },
    });
    const personIdByName = new Map<string, { id: string; version: number }>();
    for (const p of persons) {
      personIdByName.set(p.name, {
        id: p.id,
        version: p.profileBuildVersion,
      });
    }

    let created = 0;
    for (const c of parsed.knowledge_categories) {
      const resolved = personIdByName.get(c.personName.trim());
      if (!resolved) {
        this.logger.debug(
          { personName: c.personName },
          'specialists-combined.knowledge_categories: Person не найден — skip',
        );
        continue;
      }
      try {
        await this.prisma.personKnowledgeCategoryEmbedding.create({
          data: {
            tenantId,
            personId: resolved.id,
            categoryName: c.category.slice(0, 200),
            confidence: c.confidence,
            profileBuildVersion: resolved.version,
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(
          `knowledge_category[${c.personName}/${c.category}]: ${msg}`,
        );
      }
    }
    return created;
  }

  // ─────────────────────── persist: skill_traits ───────────────

  private async persistSkillTraits(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    errors: string[],
  ): Promise<number> {
    if (parsed.skill_traits.length === 0) return 0;

    const names = Array.from(
      new Set(parsed.skill_traits.map((s) => s.personName.trim())),
    ).filter((n) => n.length > 0);
    if (names.length === 0) return 0;

    const persons = await this.prisma.person.findMany({
      where: { tenantId, name: { in: names }, deletedAt: null },
      select: { id: true, name: true },
    });
    const personIdByName = new Map<string, string>();
    for (const p of persons) personIdByName.set(p.name, p.id);

    let created = 0;
    for (const s of parsed.skill_traits) {
      const personId = personIdByName.get(s.personName.trim());
      if (!personId) continue;
      try {
        const profile = await this.ensureSkillProfile(tenantId, personId);
        await this.prisma.skillTrait.create({
          data: {
            profileId: profile.id,
            category: s.category.slice(0, 200),
            statement: s.statement.slice(0, 2_000),
            confidence: s.confidence as SkillConfidence,
            observationCount: Math.max(1, s.sourceBlockIds?.length ?? 1),
            sourceBlockIds: (s.sourceBlockIds ?? []).slice(0, 50),
            firstObservedAt: new Date(),
            lastConfirmedAt: new Date(),
            status: 'active',
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`skill_trait[${s.personName}/${s.category}]: ${msg}`);
      }
    }
    return created;
  }

  private async ensureSkillProfile(
    tenantId: string,
    personId: string,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.skillProfile.findUnique({
      where: { personId },
      select: { id: true },
    });
    if (existing) return existing;
    return this.prisma.skillProfile.create({
      data: { tenantId, personId, status: 'active' },
      select: { id: true },
    });
  }

  // ─────────────────────── persist: helpfulness ────────────────

  private async persistHelpfulness(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    if (parsed.helpfulness_traits.length === 0) return 0;

    // helperUserHint / recipientUserHint — это имя или email; резолвим
    // через Person → User. Если не находим — skip (best-effort).
    const hints = new Set<string>();
    for (const h of parsed.helpfulness_traits) {
      hints.add(h.helperUserHint.trim());
      if (h.recipientUserHint) hints.add(h.recipientUserHint.trim());
    }
    const hintList = [...hints].filter((n) => n.length > 0);
    if (hintList.length === 0) return 0;

    const persons = await this.prisma.person.findMany({
      where: {
        tenantId,
        deletedAt: null,
        OR: [{ name: { in: hintList } }, { email: { in: hintList } }],
        userId: { not: null },
      },
      select: { name: true, email: true, userId: true },
    });
    const userByHint = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) {
        userByHint.set(p.name, p.userId);
        if (p.email) userByHint.set(p.email, p.userId);
      }
    }

    let created = 0;
    for (const h of parsed.helpfulness_traits) {
      if (!blockIdSet.has(h.sourceBlockId)) continue;
      const helperUserId = userByHint.get(h.helperUserHint.trim());
      if (!helperUserId) continue;
      const recipientUserId = h.recipientUserHint
        ? userByHint.get(h.recipientUserHint.trim()) ?? null
        : null;
      try {
        await this.prisma.helpfulnessTrait.create({
          data: {
            tenantId,
            helperUserId,
            recipientUserId,
            traitType: h.traitType,
            intensity: new Prisma.Decimal(this.clamp01(h.intensity)),
            topicHint: h.topicHint.slice(0, 200),
            sourceBlockIds: [h.sourceBlockId],
            evidenceQuote: h.evidenceQuote,
            confidence: new Prisma.Decimal(this.clamp01(h.confidence)),
            visibility: 'internal',
            lastObservedAt: new Date(),
            status: 'active',
          },
        });
        created += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`helpfulness[${h.sourceBlockId}]: ${msg}`);
      }
    }
    return created;
  }

  // ─────────────────────── helpers ───────────────────────

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private emptyResult(
    llm: SpecialistsCombinedExtractResult['llm'],
  ): SpecialistsCombinedExtractResult {
    return {
      created: {
        decisions: 0,
        ideas: 0,
        insights: 0,
        experiments: 0,
        regulations: 0,
        instructions: 0,
        knowledgeCategories: 0,
        skillTraits: 0,
        helpfulnessTraits: 0,
      },
      emptySections: [
        'decisions',
        'ideas',
        'insights',
        'experiments',
        'regulations',
        'knowledge_categories',
        'skill_traits',
        'helpfulness_traits',
      ],
      llm,
      errors: [],
    };
  }

  private recordMetrics(
    created: SpecialistsCombinedExtractResult['created'],
    llm: { modelUsed: string; tier?: string | null; inputTokens: number; outputTokens: number },
  ): void {
    if (!this.metrics) return;
    const type = SpecialistsCombinedService.METRIC_TYPE;
    const tier = llm.tier ?? 'unknown';

    // Один общий счётчик cards{type='combined', status='canonical'}
    // (status — обязательная лейбла в шаблоне специалиста, см.
    // BusinessMetricsService.incCoreSpecialistCards).
    const total =
      created.decisions +
      created.ideas +
      created.insights +
      created.experiments +
      created.regulations +
      created.instructions +
      created.knowledgeCategories +
      created.skillTraits +
      created.helpfulnessTraits;
    for (let i = 0; i < total; i++) {
      this.metrics.incCoreSpecialistCards({ type, status: 'canonical' });
    }

    if (llm.inputTokens > 0) {
      this.metrics.incCoreSpecialistLlmTokens({
        type,
        model: llm.modelUsed,
        tier,
        tokens: llm.inputTokens,
      });
    }
    if (llm.outputTokens > 0) {
      this.metrics.incCoreSpecialistLlmTokens({
        type,
        model: llm.modelUsed,
        tier,
        tokens: llm.outputTokens,
      });
    }
  }
}
