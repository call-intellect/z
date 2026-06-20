import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type DataClass,
  type DecisionStatus,
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

export interface SpecialistsCombinedExtractArgs {
  tenantId: string;
  meetingId: string;
  meetingTitle?: string;
  blocks: CombinedInputBlock[];
  jobId?: string;
  dataClass?: DataClass;
}

export interface SpecialistsCombinedExtractResult {
  created: {
    decisions: number;
    ideas: number;
    insights: number;
    experiments: number;
    regulations: number;
    instructions: number;
    knowledgeCategories: number;
    skillTraits: number;
    helpfulnessTraits: number;
  };
  emptySections: string[];
  llm: {
    modelUsed: string;
    durationMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
  };
  errors: string[];
}

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

    const parsed = this.parseToolCallOutput(result.toolCalls, result.text);

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
    created.instructions = await this.persistInstructions(
      args.tenantId,
      parsed,
      blockIdSet,
      errors,
    );
    created.knowledgeCategories = await this.persistKnowledgeCategories(
      args.tenantId,
      parsed,
      errors,
    );
    created.skillTraits = await this.persistSkillTraits(args.tenantId, parsed, errors);
    created.helpfulnessTraits = await this.persistHelpfulness(
      args.tenantId,
      parsed,
      blockIdSet,
      errors,
    );

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

  private parseToolCallOutput(
    toolCalls: Array<{ name: string; input: unknown }> | undefined,
    fallbackText: string,
  ): SpecialistsCombinedOutput {
    let rawInput: unknown = null;

    if (toolCalls && toolCalls.length > 0) {
      const direct = toolCalls.find((tc) => tc.name === SPECIALISTS_COMBINED_TOOL_NAME);
      rawInput = (direct ?? toolCalls[0])?.input ?? null;
    }

    if (rawInput === null && fallbackText) {
      try {
        rawInput = JSON.parse(fallbackText);
      } catch {}
    }

    if (rawInput === null) {
      throw new SpecialistsCombinedParseError(
        `LLM не вернул tool_calls (${SPECIALISTS_COMBINED_TOOL_NAME}) и не вернул валидный JSON в text`,
        fallbackText,
      );
    }

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
      // Б50 (K4) — детерминированный source-block дедуп. Combined-путь может
      // запускаться параллельно со старыми специалистами (см. шапку файла) или
      // ретраиться BullMQ → голый create плодил бы дубли. Guard по
      // sourceBlockIds:{has} перед create (как в single-специалистах).
      const dupDecision = await this.prisma.decision.findFirst({
        where: { tenantId, sourceBlockIds: { has: d.sourceBlockId } },
        select: { id: true },
      });
      if (dupDecision) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'decision',
          reason: 'source_block_dedup',
        });
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
            // Б58: каст согласован с полным enum `DecisionStatus`
            // (active/rolled_back/superseded/proposed/approved/rejected/
            // implemented/cancelled), чтобы combined-путь не терял статусы
            // (в т.ч. 'cancelled') в отличие от single-пути. Источник enum —
            // schema.prisma; контракт извлечения — DecisionDraftSchema.
            status: (d.status ?? 'approved') as DecisionStatus,
            confidence: new Prisma.Decimal(this.clamp01(d.confidence)),
          },
        });
        created += 1;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          this.isSourceIdeaBlockUniqueViolation(err)
        ) {
          this.metrics?.incCoreSpecialistExtractionFailure({
            type: 'decision',
            reason: 'db_conflict',
          });
          this.logger.debug(
            { sourceBlockId: d.sourceBlockId },
            'specialists-combined.decisions: P2002 sourceIdeaBlockId — решение уже создано другим писателем, дедуп',
          );
          continue;
        }
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

  private async persistIdeas(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const i of parsed.ideas) {
      if (!blockIdSet.has(i.sourceBlockId)) continue;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupIdea = await this.prisma.idea.findFirst({
        where: { tenantId, sourceBlockIds: { has: i.sourceBlockId } },
        select: { id: true },
      });
      if (dupIdea) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'idea',
          reason: 'source_block_dedup',
        });
        continue;
      }
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

  private async persistInsights(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const it of parsed.insights) {
      if (!blockIdSet.has(it.sourceBlockId)) continue;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupInsight = await this.prisma.insight.findFirst({
        where: { tenantId, sourceBlockIds: { has: it.sourceBlockId } },
        select: { id: true },
      });
      if (dupInsight) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'insight',
          reason: 'source_block_dedup',
        });
        continue;
      }
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

  private async persistExperiments(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const e of parsed.experiments) {
      if (!blockIdSet.has(e.sourceBlockId)) continue;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupExperiment = await this.prisma.experiment.findFirst({
        where: { tenantId, sourceBlockIds: { has: e.sourceBlockId } },
        select: { id: true },
      });
      if (dupExperiment) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'experiment',
          reason: 'source_block_dedup',
        });
        continue;
      }
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

  private async persistRegulations(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    let created = 0;
    for (const r of parsed.regulations) {
      if (!blockIdSet.has(r.sourceBlockId)) continue;
      if (r.kind === 'instruction') continue;
      let gateStrict: boolean;
      try {
        gateStrict = this.cfg?.aiFeatures.regulationGateStrict !== false;
      } catch {
        gateStrict = true;
      }
      const isDeclaredNeed = r.extractionStatus === 'нужен' || r.extractionStatus === 'обсуждается';
      if (gateStrict && r.isOrgNorm === false && !isDeclaredNeed) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'regulation',
          reason: 'not_a_norm',
        });
        continue;
      }
      try {
        // Б57 (K4) — провенанс через `set: union(...)` вместо `{ push }`:
        // pre-fetch существующего массива → дедуп при повторной встрече того же
        // имени. Контракт совпадает с single-путём (mergeIntoExisting).
        const existingReg = await this.prisma.regulation.findUnique({
          where: { tenantId_name: { tenantId, name: r.name } },
          select: { sourceBlockIds: true },
        });
        await this.prisma.regulation.upsert({
          where: {
            tenantId_name: { tenantId, name: r.name },
          },
          update: {
            statement: r.statement,
            sourceBlockIds: {
              set: this.union(existingReg?.sourceBlockIds ?? [], [
                r.sourceBlockId,
              ]),
            },
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
        r.roles
          ?.find((x) => x && x.trim().length > 0)
          ?.trim()
          .slice(0, 120) ?? null;
      const status: 'active' | 'deprecated' =
        r.extractionStatus === 'нужен' || r.extractionStatus === 'обсуждается'
          ? 'deprecated'
          : 'active';
      try {
        // Б57 (K4) — провенанс через `set: union(...)` вместо `{ push }`
        // (см. persistRegulations).
        const existingInstr = await this.prisma.instruction.findUnique({
          where: { tenantId_name: { tenantId, name: r.name } },
          select: { sourceBlockIds: true },
        });
        await this.prisma.instruction.upsert({
          where: { tenantId_name: { tenantId, name: r.name } },
          update: {
            statement: r.statement,
            contentMd: r.statement,
            sourceBlockIds: {
              set: this.union(existingInstr?.sourceBlockIds ?? [], [
                r.sourceBlockId,
              ]),
            },
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

  private async persistKnowledgeCategories(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    errors: string[],
  ): Promise<number> {
    if (parsed.knowledge_categories.length === 0) return 0;

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
        errors.push(`knowledge_category[${c.personName}/${c.category}]: ${msg}`);
      }
    }
    return created;
  }

  private async persistSkillTraits(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    errors: string[],
  ): Promise<number> {
    if (parsed.skill_traits.length === 0) return 0;

    const names = Array.from(new Set(parsed.skill_traits.map((s) => s.personName.trim()))).filter(
      (n) => n.length > 0,
    );
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

  private async ensureSkillProfile(tenantId: string, personId: string): Promise<{ id: string }> {
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

  private async persistHelpfulness(
    tenantId: string,
    parsed: SpecialistsCombinedOutput,
    blockIdSet: Set<string>,
    errors: string[],
  ): Promise<number> {
    if (parsed.helpfulness_traits.length === 0) return 0;

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
        ? (userByHint.get(h.recipientUserHint.trim()) ?? null)
        : null;
      // Б50 (K4) — source-block дедуп перед create (см. persistDecisions).
      const dupHelpfulness = await this.prisma.helpfulnessTrait.findFirst({
        where: { tenantId, sourceBlockIds: { has: h.sourceBlockId } },
        select: { id: true },
      });
      if (dupHelpfulness) {
        this.metrics?.incCoreSpecialistSkipped({
          specialist: 'helpfulness',
          reason: 'source_block_dedup',
        });
        continue;
      }
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

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private isSourceIdeaBlockUniqueViolation(
    err: Prisma.PrismaClientKnownRequestError,
  ): boolean {
    const target = err.meta?.['target'];
    if (Array.isArray(target)) return target.includes('sourceIdeaBlockId');
    return typeof target === 'string' && target.includes('sourceIdeaBlockId');
  }

  /**
   * Б57 (K4) — объединение массивов с дедупом (эталон —
   * specialist-3-3-decisions.service.ts `union`). Combined-путь обновляет
   * провенанс regulation/instruction через upsert; `{ push }` без дедупа
   * накапливал бы дубли sourceBlockId при повторной встрече того же имени.
   */
  private union<T>(a: readonly T[], b: readonly T[]): T[] {
    return [...new Set([...a, ...b])];
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
