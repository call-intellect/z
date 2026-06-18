import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  type Person,
  type SkillConfidence,
  type SkillProfile,
  type SkillTrait,
  type SkillTraitLayer,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  PROCESS_MARKER_DETECT_JSON_SCHEMA,
  PROCESS_MARKER_DETECT_SCHEMA_NAME,
  PROCESS_MARKER_DETECT_SYSTEM_PROMPT,
  PROCESS_MARKER_DETECT_USER_TEMPLATE,
} from '../prompts/process-marker-detect.prompt';
import {
  SKILL_TRAIT_DETECT_JSON_SCHEMA,
  SKILL_TRAIT_DETECT_SCHEMA_NAME,
  SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
  SKILL_TRAIT_DETECT_USER_TEMPLATE,
} from '../prompts/skill-trait-detect.prompt';
import {
  SKILL_TRAIT_MERGE_JSON_SCHEMA,
  SKILL_TRAIT_MERGE_SCHEMA_NAME,
  SKILL_TRAIT_MERGE_SYSTEM_PROMPT,
  SKILL_TRAIT_MERGE_USER_TEMPLATE,
} from '../prompts/skill-trait-merge.prompt';
import {
  SKILL_TRAIT_VERIFY_JSON_SCHEMA,
  SKILL_TRAIT_VERIFY_SCHEMA_NAME,
  SKILL_TRAIT_VERIFY_SYSTEM_PROMPT,
  SKILL_TRAIT_VERIFY_USER_TEMPLATE,
} from '../prompts/skill-trait-verify.prompt';
import {
  VALUE_MOTIVATION_DETECT_JSON_SCHEMA,
  VALUE_MOTIVATION_DETECT_SCHEMA_NAME,
  VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT,
  VALUE_MOTIVATION_DETECT_USER_TEMPLATE,
} from '../prompts/value-motivation-detect.prompt';

import { KnowledgeEmbeddingService } from './embedding.service';
import { SkillTraitConceptService } from './skill-trait-concept.service';
import { Specialist37ProbeService } from './specialist-3-7-skill-probe.service';

@Injectable()
export class Specialist37Service {
  private readonly logger = new Logger(Specialist37Service.name);

  static readonly SPECIALIST_NAME = '3-7-skill';
  static readonly METRIC_TYPE = 'skill_trait';
  private static readonly GROUP_SIMILARITY_THRESHOLD = 0.78;
  private static readonly MERGE_KNN_TOP_K = 5;
  private static readonly ARBITRATION_FLOOR = 0.78;
  private static readonly MAX_BLOCKS_PER_REBUILD = 200;
  private static readonly MAX_GROUPS_PER_REBUILD = 12;
  private static readonly PROCESS_MARKER_STOP_MARKERS: readonly string[] = [
    'избегает',
    'не решает сам',
    'зависим',
    'нерешителен',
    'медлителен',
    'не способен',
    'боится',
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(Specialist37ProbeService)
    private readonly probes: Specialist37ProbeService,
    @Inject(SkillTraitConceptService)
    private readonly concepts: SkillTraitConceptService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async getOrCreateForPerson(args: {
    tenantId: string;
    personId: string;
  }): Promise<SkillProfile | null> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        tenantId: true,
        relationship: true,
        deletedAt: true,
      },
    });
    if (!person || person.deletedAt) return null;
    if (person.tenantId !== args.tenantId) return null;
    if (person.relationship !== 'employee') return null;

    const existing = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.skillProfile.create({
        data: {
          tenantId: args.tenantId,
          personId: args.personId,
          status: 'active',
        },
      });
    } catch (err) {
      this.logger.debug(
        { personId: args.personId, err: err instanceof Error ? err.message : String(err) },
        'specialist-3-7.getOrCreateForPerson: race / упало — re-read',
      );
      return this.prisma.skillProfile.findUnique({
        where: { personId: args.personId },
      });
    }
  }

  async verifyPendingTraits(
    limit = 100,
  ): Promise<{ checked: number; promoted: number; held: number }> {
    let checked = 0;
    let promoted = 0;
    let held = 0;
    try {
      const archiveCutoff = new Date(
        Date.now() - this.cfg.skill.archiveMonths * 30 * 24 * 60 * 60 * 1000,
      );
      const pending = await this.prisma.skillTrait.findMany({
        where: {
          status: 'pending_verification',
          createdAt: { gte: archiveCutoff },
        },
        select: {
          id: true,
          conceptId: true,
          category: true,
          statement: true,
          sourceBlockIds: true,
          profileId: true,
          profile: { select: { tenantId: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });

      for (const trait of pending) {
        checked++;
        const tenantId = trait.profile?.tenantId ?? null;
        try {
          const blockIds = trait.sourceBlockIds.slice(0, 10);
          const blocks = blockIds.length
            ? await this.prisma.ideaBlock.findMany({
                where: { id: { in: blockIds } },
                select: {
                  id: true,
                  criticalQuestion: true,
                  trustedAnswer: true,
                },
              })
            : [];
          const quotes = blocks.map((b) => ({
            blockId: b.id,
            quote: `${b.criticalQuestion} ${b.trustedAnswer}`.slice(0, 600),
          }));

          if (quotes.length < 2) {
            held++;
            continue;
          }

          const res = await this.llm.call({
            taskType: 'skill-trait-verify',
            systemPrompt: SKILL_TRAIT_VERIFY_SYSTEM_PROMPT,
            userMessage: SKILL_TRAIT_VERIFY_USER_TEMPLATE({
              category: trait.category,
              statement: trait.statement,
              quotes,
            }),
            tenantId,
            responseFormat: {
              type: 'json_schema',
              name: SKILL_TRAIT_VERIFY_SCHEMA_NAME,
              schema: SKILL_TRAIT_VERIFY_JSON_SCHEMA,
              strict: true,
            },
            sourceRef: { type: 'skill_profile', id: trait.profileId },
            dataClass: 'internal',
          });

          const parsed = JSON.parse(res.text) as { grounded?: unknown };
          const grounded = parsed.grounded === true;
          if (grounded) {
            await this.prisma.skillTrait.update({
              where: { id: trait.id },
              data: { status: 'active' },
            });
            promoted++;
            if (trait.conceptId) {
              await this.concepts.recomputeTraitCount(trait.conceptId).catch(() => undefined);
            }
          } else {
            held++;
          }
        } catch (err) {
          this.logger.warn(
            {
              traitId: trait.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'specialist-3-7.verifyPendingTraits: verify упал — fail-open promote в active',
          );
          try {
            await this.prisma.skillTrait.update({
              where: { id: trait.id },
              data: { status: 'active' },
            });
            promoted++;
            if (trait.conceptId) {
              await this.concepts.recomputeTraitCount(trait.conceptId).catch(() => undefined);
            }
          } catch (updErr) {
            this.logger.warn(
              {
                traitId: trait.id,
                err: updErr instanceof Error ? updErr.message : String(updErr),
              },
              'specialist-3-7.verifyPendingTraits: fail-open update тоже упал — skip',
            );
          }
        }
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-7.verifyPendingTraits: выборка/проход упали',
      );
      return { checked, promoted, held };
    }
    return { checked, promoted, held };
  }

  async rebuildProfile(args: { profileId: string }): Promise<void> {
    const start = Date.now();
    try {
      const profile = await this.prisma.skillProfile.findUnique({
        where: { id: args.profileId },
        include: {
          person: {
            select: {
              id: true,
              tenantId: true,
              name: true,
              entityId: true,
              relationship: true,
              deletedAt: true,
            },
          },
        },
      });
      if (!profile) {
        this.logger.debug(
          { profileId: args.profileId },
          'specialist-3-7: profile не найден — skip',
        );
        return;
      }
      if (profile.person.deletedAt) {
        this.logger.debug({ profileId: args.profileId }, 'specialist-3-7: person удалён — skip');
        return;
      }

      const newStatus = this.statusForRelationship(profile.person.relationship);
      if (newStatus !== profile.status) {
        await this.prisma.skillProfile.update({
          where: { id: profile.id },
          data: { status: newStatus },
        });
        if (newStatus !== 'active') {
          this.logger.debug(
            { profileId: profile.id, status: newStatus },
            'specialist-3-7: profile переведён в неактивный статус — skip rebuild',
          );
          return;
        }
      }
      if (profile.person.relationship !== 'employee') {
        return;
      }

      const blocks = await this.loadSubjectReasoningBlocks({
        tenantId: profile.tenantId,
        entityId: profile.person.entityId,
        lookbackMonths: this.cfg.skill.lookbackMonths,
      });
      const profileMinObservations = await this.cfg.getDynamic<number>(
        'knowledge.skillProfileMinObservations',
        undefined,
        this.cfg.skill.minObservations,
      );
      if (blocks.length < profileMinObservations) {
        this.logger.debug(
          { profileId: profile.id, blocksCount: blocks.length, profileMinObservations },
          'specialist-3-7: блоков меньше порога — skip',
        );
        return;
      }
      const clusterMinObservations = await this.cfg.getDynamic<number>(
        'knowledge.skillClusterMinObservations',
        undefined,
        3,
      );

      const groups = await this.groupBlocksBySimilarity(blocks);
      const eligibleGroups = groups
        .filter((g) => g.length >= clusterMinObservations)
        .slice(0, Specialist37Service.MAX_GROUPS_PER_REBUILD);
      this.logger.debug(
        {
          profileId: profile.id,
          blocksCount: blocks.length,
          groupsTotal: groups.length,
          eligibleGroups: eligibleGroups.length,
        },
        'specialist-3-7: группировка завершена',
      );

      let createdNew = 0;
      let mergedCount = 0;
      let supersededCount = 0;
      for (const group of eligibleGroups) {
        const draft = await this.detectTrait({
          profile,
          personName: profile.person.name,
          group,
        });
        if (!draft) continue;

        const result = await this.mergeOrCreate({ profile, draft });
        if (result === 'created') createdNew++;
        else if (result === 'merged') mergedCount++;
        else if (result === 'superseded') supersededCount++;
      }

      if (this.cfg.skill.valueMotivationDetectEnabled) {
        for (const group of eligibleGroups) {
          const draft = await this.detectValueMotivation({
            profile,
            personName: profile.person.name,
            group,
          });
          if (!draft) continue;

          const result = await this.mergeOrCreate({
            profile,
            draft,
            layer: draft.layer,
          });
          if (result === 'created') createdNew++;
          else if (result === 'merged') mergedCount++;
          else if (result === 'superseded') supersededCount++;
        }
      }

      if (this.cfg.skill.processMarkerDetectEnabled) {
        for (const group of eligibleGroups) {
          const draft = await this.detectProcessMarker({
            profile,
            personName: profile.person.name,
            group,
          });
          if (!draft) continue;

          const result = await this.mergeOrCreate({
            profile,
            draft,
            layer: 'process_marker',
          });
          if (result === 'created') createdNew++;
          else if (result === 'merged') mergedCount++;
          else if (result === 'superseded') supersededCount++;
        }
      }

      await this.runDecay(profile.id);

      await this.prisma.skillProfile.update({
        where: { id: profile.id },
        data: {
          lastBuildAt: new Date(),
          buildVersion: profile.buildVersion + 1,
        },
      });

      this.metrics.incCoreSpecialistCards({
        type: Specialist37Service.METRIC_TYPE,
        status: 'canonical',
      });

      this.logger.log(
        {
          profileId: profile.id,
          personId: profile.person.id,
          createdNew,
          mergedCount,
          supersededCount,
        },
        'specialist-3-7: rebuild завершён',
      );

      await this.probes.checkAndEmitProbes({
        tenantId: profile.tenantId,
        profileId: profile.id,
        personId: profile.person.id,
        personName: profile.person.name,
        entityId: profile.person.entityId,
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'rebuild_error',
      });
      this.logger.error(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.rebuildProfile: внутренняя ошибка',
      );
    } finally {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: Specialist37Service.METRIC_TYPE,
        seconds: (Date.now() - start) / 1000,
      });
    }
  }

  @OnEvent('person.relationship_changed')
  async onRelationshipChanged(args: {
    personId: string;
    newRelationship: Person['relationship'];
    oldRelationship?: Person['relationship'];
  }): Promise<void> {
    await this.handleRelationshipChange({
      personId: args.personId,
      newRelationship: args.newRelationship,
    });
  }

  async handleRelationshipChange(args: {
    personId: string;
    newRelationship: Person['relationship'];
  }): Promise<void> {
    const profile = await this.prisma.skillProfile.findUnique({
      where: { personId: args.personId },
    });
    if (!profile) return;
    const desired = this.statusForRelationship(args.newRelationship);
    if (desired === profile.status) return;
    try {
      await this.prisma.skillProfile.update({
        where: { id: profile.id },
        data: { status: desired },
      });
      this.logger.log(
        { profileId: profile.id, oldStatus: profile.status, newStatus: desired },
        'specialist-3-7.handleRelationshipChange: обновлён статус',
      );
    } catch (err) {
      this.logger.warn(
        {
          profileId: profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.handleRelationshipChange: не удалось обновить — skip',
      );
    }
  }

  private statusForRelationship(rel: Person['relationship']): SkillProfile['status'] {
    if (rel === 'employee') return 'active';
    if (rel === 'former') return 'archived';
    return 'paused_relationship';
  }

  private async loadSubjectReasoningBlocks(args: {
    tenantId: string;
    entityId: string | null;
    lookbackMonths: number;
  }): Promise<
    Array<{
      blockId: string;
      name: string;
      trustedAnswer: string;
      tags: string[];
      createdAt: Date;
      quote: string;
      embedding: number[] | null;
    }>
  > {
    if (!args.entityId) return [];

    const lookbackMs = args.lookbackMonths * 30 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs);

    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: args.entityId,
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
      take: Specialist37Service.MAX_BLOCKS_PER_REBUILD,
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];
    if (blockIds.length === 0) return [];

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        tags: true,
        createdAt: true,
        evidence: {
          select: { quote: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const embeddings = await this.loadEmbeddings(blocks.map((b) => b.id));

    return blocks.map((b) => ({
      blockId: b.id,
      name: b.name,
      trustedAnswer: b.trustedAnswer ?? '',
      tags: b.tags,
      createdAt: b.createdAt,
      quote: b.evidence[0]?.quote ?? b.trustedAnswer ?? b.name,
      embedding: embeddings.get(b.id) ?? null,
    }));
  }

  private async loadEmbeddings(blockIds: string[]): Promise<Map<string, number[]>> {
    if (blockIds.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; emb: string | null }>
      >`SELECT "id", "embedding"::text AS "emb" FROM "IdeaBlock" WHERE "id" IN (${Prisma.join(blockIds)}) AND "embedding" IS NOT NULL`;
      const map = new Map<string, number[]>();
      for (const r of rows) {
        if (!r.emb) continue;
        const inner = r.emb.replace(/^\[|\]$/g, '');
        if (!inner) continue;
        const vec = inner.split(',').map((s) => Number(s));
        if (vec.every((n) => Number.isFinite(n))) {
          map.set(r.id, vec);
        }
      }
      return map;
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'specialist-3-7.loadEmbeddings: упал, fallback на пустую мапу',
      );
      return new Map();
    }
  }

  private async groupBlocksBySimilarity(
    blocks: Array<{
      blockId: string;
      quote: string;
      embedding: number[] | null;
    }>,
  ): Promise<Array<typeof blocks>> {
    const threshold = Specialist37Service.GROUP_SIMILARITY_THRESHOLD;
    const groups: Array<typeof blocks> = [];
    for (const block of blocks) {
      if (!block.embedding) {
        groups.push([block]);
        continue;
      }
      let placed = false;
      for (const g of groups) {
        const head = g[0];
        if (!head || !head.embedding) continue;
        const sim = cosineSimilarity(block.embedding, head.embedding);
        if (sim >= threshold) {
          g.push(block);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([block]);
    }
    return groups.sort((a, b) => b.length - a.length);
  }

  private async detectTrait(args: {
    profile: SkillProfile;
    personName: string;
    group: Array<{
      blockId: string;
      quote: string;
      createdAt?: Date;
    }>;
  }): Promise<TraitDraft | null> {
    const quotesForLlm = args.group.slice(0, 12).map((b) => ({
      blockId: b.blockId,
      quote: b.quote,
      observedAt: (b.createdAt ?? new Date()).toISOString(),
    }));

    const guardOnDetect = this.isPromptInjectionGuardEnabled();
    const rawUserDetect = SKILL_TRAIT_DETECT_USER_TEMPLATE({
      personName: args.personName,
      personRole: null,
      quotes: quotesForLlm,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'skill-trait-detect',
        systemPrompt: guardOnDetect
          ? withInjectionGuard(SKILL_TRAIT_DETECT_SYSTEM_PROMPT)
          : SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnDetect ? wrapUserData(rawUserDetect) : rawUserDetect,
        tenantId: args.profile.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: SKILL_TRAIT_DETECT_SCHEMA_NAME,
          schema: SKILL_TRAIT_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profile.id },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.detectTrait: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist37Service.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    const draft = parseTraitDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason,
      });
    });
    if (!draft) return null;
    if (draft.sourceBlockIds.length === 0) return null;
    return draft;
  }

  private async detectValueMotivation(args: {
    profile: SkillProfile;
    personName: string;
    group: Array<{
      blockId: string;
      quote: string;
      createdAt?: Date;
    }>;
  }): Promise<(TraitDraft & { layer: 'value' | 'motivation' }) | null> {
    const quotesForLlm = args.group.slice(0, 12).map((b) => ({
      blockId: b.blockId,
      quote: b.quote,
      observedAt: (b.createdAt ?? new Date()).toISOString(),
    }));

    const guardOnDetect = this.isPromptInjectionGuardEnabled();
    const rawUserDetect = VALUE_MOTIVATION_DETECT_USER_TEMPLATE({
      personName: args.personName,
      personRole: null,
      quotes: quotesForLlm,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'value-motivation-detect',
        systemPrompt: guardOnDetect
          ? withInjectionGuard(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT)
          : VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnDetect ? wrapUserData(rawUserDetect) : rawUserDetect,
        tenantId: args.profile.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: VALUE_MOTIVATION_DETECT_SCHEMA_NAME,
          schema: VALUE_MOTIVATION_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profile.id },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'value_motivation',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.detectValueMotivation: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'value_motivation',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    const draft = parseValueMotivationDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'value_motivation',
        reason,
      });
    });
    if (!draft) return null;
    if (draft.sourceBlockIds.length === 0) return null;
    return draft;
  }

  private async detectProcessMarker(args: {
    profile: SkillProfile;
    personName: string;
    group: Array<{
      blockId: string;
      quote: string;
      createdAt?: Date;
    }>;
  }): Promise<(TraitDraft & { layer: 'process_marker' }) | null> {
    const quotesForLlm = args.group.slice(0, 12).map((b) => ({
      blockId: b.blockId,
      quote: b.quote,
      observedAt: (b.createdAt ?? new Date()).toISOString(),
    }));

    const guardOnDetect = this.isPromptInjectionGuardEnabled();
    const rawUserDetect = PROCESS_MARKER_DETECT_USER_TEMPLATE({
      personName: args.personName,
      personRole: null,
      quotes: quotesForLlm,
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'process-marker-detect',
        systemPrompt: guardOnDetect
          ? withInjectionGuard(PROCESS_MARKER_DETECT_SYSTEM_PROMPT)
          : PROCESS_MARKER_DETECT_SYSTEM_PROMPT,
        userMessage: guardOnDetect ? wrapUserData(rawUserDetect) : rawUserDetect,
        tenantId: args.profile.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: PROCESS_MARKER_DETECT_SCHEMA_NAME,
          schema: PROCESS_MARKER_DETECT_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profile.id },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'process_marker',
        reason: 'llm_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.detectProcessMarker: LLM упал — skip',
      );
      return null;
    }

    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'process_marker',
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }

    const draft = parseTraitDraft(result.text, (reason) => {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: 'process_marker',
        reason,
      });
    });
    if (!draft) return null;
    if (draft.sourceBlockIds.length === 0) return null;

    const lower = draft.statement.toLowerCase();
    const stopMarker = Specialist37Service.PROCESS_MARKER_STOP_MARKERS.find((m) =>
      lower.includes(m),
    );
    if (stopMarker) {
      this.logger.warn(
        {
          profileId: args.profile.id,
          marker: stopMarker,
          category: draft.category,
        },
        'specialist-3-7.detectProcessMarker: оценочная лексика в statement — отбрасываю (rejected_guard)',
      );
      return null;
    }

    return { ...draft, layer: 'process_marker' };
  }

  private async mergeOrCreate(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    layer?: SkillTraitLayer;
  }): Promise<'created' | 'merged' | 'superseded' | 'skipped'> {
    const layer: SkillTraitLayer = args.layer ?? 'skill';
    const threshold = this.cfg.skill.traitSimilarityThreshold;

    let candidates: Array<{
      id: string;
      category: string;
      statement: string;
      confidence: SkillConfidence;
      lastConfirmedAt: Date;
      observationCount: number;
      sourceBlockIds: string[];
      bucket: 'hard' | 'band';
    }> = [];

    let embedding: number[] | null;
    try {
      embedding = await this.embedder.embedQuery(
        `${args.draft.category}. ${args.draft.statement}`.slice(0, 2_000),
      );
    } catch {
      embedding = null;
    }

    if (embedding) {
      try {
        const vec = `[${embedding.join(',')}]`;
        const rows = await this.prisma.$queryRawUnsafe<
          Array<{
            id: string;
            category: string;
            statement: string;
            confidence: SkillConfidence;
            lastConfirmedAt: Date;
            observationCount: number;
            sourceBlockIds: string[];
            distance: number;
          }>
        >(
          `SELECT "id", "category", "statement", "confidence", "lastConfirmedAt",
                  "observationCount", "sourceBlockIds",
                  ("embedding" <=> $2::vector) AS "distance"
           FROM "skill_traits"
           WHERE "profileId" = $1
             AND "status" IN ('active', 'pending_verification')
             AND "layer" = $3::"SkillTraitLayer"
             AND "embedding" IS NOT NULL
           ORDER BY "embedding" <=> $2::vector
           LIMIT ${Specialist37Service.MERGE_KNN_TOP_K}`,
          args.profile.id,
          vec,
          layer,
        );
        candidates = rows
          .filter((r) => 1 - r.distance >= Specialist37Service.ARBITRATION_FLOOR)
          .slice(0, 3)
          .map((r) => ({
            id: r.id,
            category: r.category,
            statement: r.statement,
            confidence: r.confidence,
            lastConfirmedAt: r.lastConfirmedAt,
            observationCount: r.observationCount,
            sourceBlockIds: r.sourceBlockIds ?? [],
            bucket: (1 - r.distance >= threshold ? 'hard' : 'band') as 'hard' | 'band',
          }));
      } catch (err) {
        this.logger.debug(
          {
            profileId: args.profile.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-7.mergeOrCreate: pgvector KNN упал — fallback к verdict=new',
        );
      }
    }

    if (candidates.length === 0) {
      return this.createNewTrait({
        profile: args.profile,
        draft: args.draft,
        embedding,
        layer,
      });
    }

    const verdict = await this.callMergeArbiter({
      tenantId: args.profile.tenantId,
      profileId: args.profile.id,
      draft: args.draft,
      candidates,
    });

    if (verdict.verdict === 'new') {
      const topHard = candidates.find((c) => c.bucket === 'hard');
      if (topHard) {
        this.logger.debug(
          {
            profileId: args.profile.id,
            targetId: topHard.id,
            arbiterReasoning: verdict.reasoning,
          },
          'specialist-3-7.mergeOrCreate: Г2 — арбитр вернул new при hard-кандидате, форсим merge',
        );
        await this.mergeIntoExisting({
          profileId: args.profile.id,
          existing: {
            id: topHard.id,
            sourceBlockIds: topHard.sourceBlockIds,
            observationCount: topHard.observationCount,
            confidence: topHard.confidence,
            lastConfirmedAt: topHard.lastConfirmedAt,
          },
          draft: args.draft,
          embedding,
        });
        return 'merged';
      }
    }

    if (verdict.verdict === 'merge' && verdict.targetId) {
      const target = candidates.find((c) => c.id === verdict.targetId);
      if (!target) {
        return this.createNewTrait({
          profile: args.profile,
          draft: args.draft,
          embedding,
          layer,
        });
      }
      await this.mergeIntoExisting({
        profileId: args.profile.id,
        existing: {
          id: target.id,
          sourceBlockIds: target.sourceBlockIds,
          observationCount: target.observationCount,
          confidence: target.confidence,
          lastConfirmedAt: target.lastConfirmedAt,
        },
        draft: args.draft,
        embedding,
      });
      return 'merged';
    }

    if (verdict.verdict === 'supersedes' && verdict.targetId) {
      const target = candidates.find((c) => c.id === verdict.targetId);
      if (!target) {
        return this.createNewTrait({
          profile: args.profile,
          draft: args.draft,
          embedding,
          layer,
        });
      }
      const newTraitId = await this.createNewTraitRaw({
        profile: args.profile,
        draft: args.draft,
        embedding,
        layer,
      });
      if (!newTraitId) return 'skipped';
      await this.prisma.skillTrait.update({
        where: { id: target.id },
        data: { status: 'superseded_by', supersededById: newTraitId },
      });
      return 'superseded';
    }

    return this.createNewTrait({
      profile: args.profile,
      draft: args.draft,
      embedding,
      layer,
    });
  }

  private async callMergeArbiter(args: {
    tenantId: string;
    profileId: string;
    draft: TraitDraft;
    candidates: Array<{
      id: string;
      category: string;
      statement: string;
      confidence: SkillConfidence;
      lastConfirmedAt: Date;
      bucket: 'hard' | 'band';
    }>;
  }): Promise<MergeVerdict> {
    const guardOnMerge = this.isPromptInjectionGuardEnabled();
    const rawUserMerge = SKILL_TRAIT_MERGE_USER_TEMPLATE({
      draft: {
        category: args.draft.category,
        statement: args.draft.statement,
        confidence: args.draft.confidence,
      },
      candidates: args.candidates.map((c) => ({
        id: c.id,
        category: c.category,
        statement: c.statement,
        confidence: c.confidence,
        lastConfirmedAt: c.lastConfirmedAt.toISOString(),
        bucket: c.bucket,
      })),
    });
    let result: LlmCallResult;
    try {
      result = await this.llm.call({
        taskType: 'skill-trait-merge',
        systemPrompt: guardOnMerge
          ? withInjectionGuard(SKILL_TRAIT_MERGE_SYSTEM_PROMPT)
          : SKILL_TRAIT_MERGE_SYSTEM_PROMPT,
        userMessage: guardOnMerge ? wrapUserData(rawUserMerge) : rawUserMerge,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: SKILL_TRAIT_MERGE_SCHEMA_NAME,
          schema: SKILL_TRAIT_MERGE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profileId },
        dataClass: 'internal',
      });
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'arbiter_skip',
      });
      this.logger.warn(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.callMergeArbiter: LLM упал — fallback к verdict=new',
      );
      return { verdict: 'new', targetId: null, reasoning: 'arbiter_skipped' };
    }
    if (result.modelUsed) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: Specialist37Service.METRIC_TYPE,
        model: result.modelUsed,
        tier: result.tier ?? 'primary',
        tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
      });
    }
    try {
      const parsed = JSON.parse(result.text) as MergeVerdict;
      if (
        parsed.verdict !== 'merge' &&
        parsed.verdict !== 'supersedes' &&
        parsed.verdict !== 'new'
      ) {
        return { verdict: 'new', targetId: null, reasoning: 'invalid_verdict' };
      }
      const candidateIds = new Set(args.candidates.map((c) => c.id));
      if (parsed.verdict !== 'new' && parsed.targetId && !candidateIds.has(parsed.targetId)) {
        return {
          verdict: 'new',
          targetId: null,
          reasoning: 'targetId_not_in_candidates',
        };
      }
      return parsed;
    } catch {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'arbiter_json_parse',
      });
      return { verdict: 'new', targetId: null, reasoning: 'arbiter_parse_failed' };
    }
  }

  private async createNewTrait(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    embedding: number[] | null;
    layer?: SkillTraitLayer;
  }): Promise<'created' | 'skipped'> {
    const id = await this.createNewTraitRaw(args);
    return id ? 'created' : 'skipped';
  }

  private async createNewTraitRaw(args: {
    profile: SkillProfile;
    draft: TraitDraft;
    embedding: number[] | null;
    layer?: SkillTraitLayer;
  }): Promise<string | null> {
    try {
      const trait = await this.prisma.skillTrait.create({
        data: {
          profileId: args.profile.id,
          layer: args.layer ?? 'skill',
          category: args.draft.category.slice(0, 200),
          statement: args.draft.statement.slice(0, 2_000),
          confidence: args.draft.confidence as SkillConfidence,
          observationCount: Math.max(1, Math.min(1_000, args.draft.sourceBlockIds.length)),
          sourceBlockIds: args.draft.sourceBlockIds.slice(0, 50),
          firstObservedAt: this.safeDate(args.draft.firstObservedAt),
          lastConfirmedAt: this.safeDate(args.draft.lastConfirmedAt),
          status: 'pending_verification',
        },
      });
      if (args.embedding) {
        try {
          const vec = `[${args.embedding.join(',')}]`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE "skill_traits" SET "embedding" = $1::vector WHERE "id" = $2`,
            vec,
            trait.id,
          );
        } catch {}
      }
      try {
        const concept = await this.concepts.findOrCreateConcept({
          tenantId: args.profile.tenantId,
          category: args.draft.category,
          statement: args.draft.statement,
        });
        if (concept) {
          await this.prisma.skillTrait.update({
            where: { id: trait.id },
            data: { conceptId: concept.id },
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            traitId: trait.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-7.createNewTraitRaw: concept-link упал — trait остаётся без concept (подхватит cron)',
        );
      }
      return trait.id;
    } catch (err) {
      this.metrics.incCoreSpecialistExtractionFailure({
        type: Specialist37Service.METRIC_TYPE,
        reason: 'db_error',
      });
      this.logger.warn(
        {
          profileId: args.profile.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.createNewTraitRaw: insert упал',
      );
      return null;
    }
  }

  private async mergeIntoExisting(args: {
    profileId: string;
    existing: {
      id: string;
      sourceBlockIds: string[];
      observationCount: number;
      confidence: SkillConfidence;
      lastConfirmedAt?: Date;
    };
    draft: TraitDraft;
    embedding: number[] | null;
  }): Promise<void> {
    const merged = new Set([...args.existing.sourceBlockIds, ...args.draft.sourceBlockIds]);

    let newConfidence: SkillConfidence = args.existing.confidence;
    try {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: [...merged] } },
        select: { createdAt: true },
      });
      const distinctDays = new Set(blocks.map((b) => b.createdAt.toISOString().slice(0, 10))).size;
      const evidenceLevel: SkillConfidence =
        distinctDays >= 4 ? 'high' : distinctDays >= 2 ? 'medium' : 'low';
      newConfidence = this.maxConfidence(args.existing.confidence, evidenceLevel);
    } catch (err) {
      this.logger.debug(
        {
          traitId: args.existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.mergeIntoExisting: пересчёт confidence из дат упал — оставляем текущий',
      );
    }

    const updateAnchor = args.embedding != null && args.draft.statement.trim().length > 0;

    const draftConfirmedAt = this.safeDate(args.draft.lastConfirmedAt);
    const nextConfirmedAt =
      args.existing.lastConfirmedAt &&
      args.existing.lastConfirmedAt.getTime() > draftConfirmedAt.getTime()
        ? args.existing.lastConfirmedAt
        : draftConfirmedAt;
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.skillTrait.update({
          where: { id: args.existing.id },
          data: {
            sourceBlockIds: [...merged],
            observationCount: Math.min(1_000, merged.size),
            confidence: newConfidence,
            lastConfirmedAt: nextConfirmedAt,
            ...(updateAnchor ? { statement: args.draft.statement.slice(0, 2_000) } : {}),
          },
        });
        if (updateAnchor && args.embedding) {
          const vec = `[${args.embedding.join(',')}]`;
          await tx.$executeRawUnsafe(
            `UPDATE "skill_traits" SET "embedding" = $1::vector WHERE "id" = $2`,
            vec,
            args.existing.id,
          );
        }
      });
    } catch (err) {
      this.logger.warn(
        {
          traitId: args.existing.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.mergeIntoExisting: update упал — skip',
      );
    }
  }

  private maxConfidence(a: SkillConfidence, b: SkillConfidence): SkillConfidence {
    const RANK: Record<SkillConfidence, number> = { low: 0, medium: 1, high: 2 };
    return RANK[a] >= RANK[b] ? a : b;
  }

  private async runDecay(profileId: string): Promise<void> {
    const decayCutoff = new Date(
      Date.now() - this.cfg.skill.decayMonths * 30 * 24 * 60 * 60 * 1000,
    );
    const archiveCutoff = new Date(
      Date.now() - this.cfg.skill.archiveMonths * 30 * 24 * 60 * 60 * 1000,
    );

    try {
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          lastConfirmedAt: { lt: archiveCutoff },
        },
        data: { status: 'archived' },
      });

      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'pending_verification',
          createdAt: { lt: archiveCutoff },
        },
        data: { status: 'archived' },
      });

      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          confidence: 'medium',
          lastConfirmedAt: { lt: decayCutoff },
        },
        data: { confidence: 'low' },
      });
      await this.prisma.skillTrait.updateMany({
        where: {
          profileId,
          status: 'active',
          confidence: 'high',
          lastConfirmedAt: { lt: decayCutoff },
        },
        data: { confidence: 'medium' },
      });
    } catch (err) {
      this.logger.warn(
        {
          profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7.runDecay: упал — skip',
      );
    }
  }

  async getEmployeeProfile(args: {
    tenantId: string;
    personId: string;
  }): Promise<(SkillProfile & { traits: SkillTrait[] }) | null> {
    return this.prisma.skillProfile.findFirst({
      where: { tenantId: args.tenantId, personId: args.personId },
      include: {
        traits: {
          where: { status: 'active' },
          orderBy: [{ confidence: 'desc' }, { lastConfirmedAt: 'desc' }],
        },
      },
    });
  }

  private safeDate(input: string | null | undefined): Date {
    if (!input) return new Date();
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return new Date();
    return d;
  }
}

export interface TraitDraft {
  category: string;
  statement: string;
  confidence: 'low' | 'medium' | 'high';
  sourceBlockIds: string[];
  firstObservedAt: string;
  lastConfirmedAt: string;
  layer?: 'skill' | 'value' | 'motivation' | 'process_marker';
}

interface MergeVerdict {
  verdict: 'merge' | 'supersedes' | 'new';
  targetId: string | null;
  reasoning: string;
}

function parseTraitDraft(text: string, onFailure: (reason: string) => void): TraitDraft | null {
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
  const category = typeof obj.category === 'string' ? obj.category.trim() : '';
  const statement = typeof obj.statement === 'string' ? obj.statement.trim() : '';
  const confidenceRaw = obj.confidence;
  const confidence =
    confidenceRaw === 'low' || confidenceRaw === 'medium' || confidenceRaw === 'high'
      ? confidenceRaw
      : null;
  if (!category || !statement || !confidence) {
    onFailure('schema_validation');
    return null;
  }
  const sourceBlockIds: string[] = [];
  if (Array.isArray(obj.sourceBlockIds)) {
    for (const id of obj.sourceBlockIds) {
      if (typeof id === 'string' && id.length > 0) sourceBlockIds.push(id);
    }
  }
  const firstObservedAt =
    typeof obj.firstObservedAt === 'string' && obj.firstObservedAt.length > 0
      ? obj.firstObservedAt
      : new Date().toISOString();
  const lastConfirmedAt =
    typeof obj.lastConfirmedAt === 'string' && obj.lastConfirmedAt.length > 0
      ? obj.lastConfirmedAt
      : new Date().toISOString();
  const layerRaw = obj.layer;
  const layer =
    layerRaw === 'skill' ||
    layerRaw === 'value' ||
    layerRaw === 'motivation' ||
    layerRaw === 'process_marker'
      ? layerRaw
      : undefined;
  return {
    category,
    statement,
    confidence,
    sourceBlockIds,
    firstObservedAt,
    lastConfirmedAt,
    ...(layer ? { layer } : {}),
  };
}

function parseValueMotivationDraft(
  text: string,
  onFailure: (reason: string) => void,
): (TraitDraft & { layer: 'value' | 'motivation' }) | null {
  const draft = parseTraitDraft(text, onFailure);
  if (!draft) return null;
  if (draft.layer !== 'value' && draft.layer !== 'motivation') {
    onFailure('schema_validation');
    return null;
  }
  return draft as TraitDraft & { layer: 'value' | 'motivation' };
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
