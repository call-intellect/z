import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PracticeSkill } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { SKILL_SUBJECT_SIGNAL_TYPES } from '../../knowledge-core/constants/skill-signal-types';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';
import {
  PRACTICE_SKILL_EXTRACT_JSON_SCHEMA,
  PRACTICE_SKILL_EXTRACT_SCHEMA_NAME,
  PRACTICE_SKILL_EXTRACT_SYSTEM_PROMPT,
  PRACTICE_SKILL_EXTRACT_USER_TEMPLATE,
  type PracticeSkillExtractBlock,
} from '../prompts/practice-skill-extract.prompt';

@Injectable()
export class PracticeSkillExtractorService {
  private readonly logger = new Logger(PracticeSkillExtractorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async extractForConcept(args: { tenantId: string; conceptId: string }): Promise<PracticeSkill[]> {
    const concept = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.conceptId },
      select: {
        id: true,
        tenantId: true,
        canonicalName: true,
        status: true,
        traitCount: true,
      },
    });
    if (!concept || concept.tenantId !== args.tenantId) return [];
    if (concept.status !== 'active') return [];
    if (concept.traitCount < this.cfg.practiceSkills.minTraitsForExtract) {
      this.logger.debug(
        `practice-skill-extract: concept=${concept.id} traits=${concept.traitCount} < min=${this.cfg.practiceSkills.minTraitsForExtract} — skip`,
      );
      return [];
    }

    const traits = await this.prisma.skillTrait.findMany({
      where: { conceptId: concept.id, status: 'active' },
      select: {
        id: true,
        statement: true,
        sourceBlockIds: true,
        profileId: true,
      },
      take: 200,
    });
    if (traits.length === 0) return [];

    const profileIds = [...new Set(traits.map((t) => t.profileId))];
    const profiles = await this.prisma.skillProfile.findMany({
      where: { id: { in: profileIds } },
      select: { id: true, personId: true, tenantId: true },
    });
    const profileToPerson = new Map(profiles.map((p) => [p.id, p.personId]));

    const byPerson = new Map<string, typeof traits>();
    for (const t of traits) {
      const personId = profileToPerson.get(t.profileId);
      if (!personId) continue;
      const arr = byPerson.get(personId) ?? [];
      arr.push(t);
      byPerson.set(personId, arr);
    }

    const created: PracticeSkill[] = [];
    for (const [personId, personTraits] of byPerson) {
      try {
        const r = await this.extractForPerson({
          tenantId: args.tenantId,
          conceptId: concept.id,
          conceptName: concept.canonicalName,
          personId,
          personTraits: personTraits.map((t) => ({
            id: t.id,
            statement: t.statement,
            sourceBlockIds: t.sourceBlockIds,
          })),
        });
        if (r) created.push(r);
      } catch (err) {
        this.logger.warn(
          `practice-skill-extract: concept=${concept.id} person=${personId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return created;
  }

  async extractForPerson(args: {
    tenantId: string;
    conceptId: string;
    conceptName: string;
    personId: string;
    personTraits: ReadonlyArray<{
      id: string;
      statement: string;
      sourceBlockIds: string[];
    }>;
  }): Promise<PracticeSkill | null> {
    const blockIds = [...new Set(args.personTraits.flatMap((t) => t.sourceBlockIds))];
    if (blockIds.length === 0) {
      this.logger.debug(
        `practice-skill-extract: concept=${args.conceptId} person=${args.personId} — нет sourceBlockIds, skip`,
      );
      return null;
    }
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId: args.tenantId,
        status: 'canonical',
        signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] },
      },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
      },
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    if (blocks.length === 0) {
      this.logger.debug(
        `practice-skill-extract: concept=${args.conceptId} person=${args.personId} — нет reasoning-блоков, skip`,
      );
      return null;
    }
    const promptBlocks: PracticeSkillExtractBlock[] = blocks.map((b) => ({
      id: b.id,
      text: b.trustedAnswer ?? b.name,
    }));

    const llmResult = await this.llm.call({
      taskType: 'practice-skill-extract',
      systemPrompt: PRACTICE_SKILL_EXTRACT_SYSTEM_PROMPT,
      userMessage: PRACTICE_SKILL_EXTRACT_USER_TEMPLATE({
        conceptName: args.conceptName,
        traitStatements: args.personTraits.map((t) => t.statement),
        blocks: promptBlocks,
      }),
      tenantId: args.tenantId,
      responseFormat: {
        type: 'json_schema',
        name: PRACTICE_SKILL_EXTRACT_SCHEMA_NAME,
        schema: PRACTICE_SKILL_EXTRACT_JSON_SCHEMA,
        strict: true,
      },
      dataClass: 'internal',
      sourceRef: {
        type: 'practice-skill-extract',
        id: `${args.conceptId}:${args.personId}`,
      },
    });

    let parsed: PracticeSkillExtractDraft;
    try {
      parsed = parseDraft(llmResult.text);
    } catch (err) {
      this.logger.warn(
        `practice-skill-extract: concept=${args.conceptId} person=${args.personId} JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    if (parsed.skill === null) {
      this.logger.debug(
        `practice-skill-extract: concept=${args.conceptId} person=${args.personId} — skill=null (LLM решил: не процедура)`,
      );
      return null;
    }
    if (parsed.confidence < 0.7) {
      this.logger.debug(`practice-skill-extract: low confidence ${parsed.confidence} — skip`);
      return null;
    }

    let triggerEmbedding: number[] | null;
    try {
      triggerEmbedding = await this.embedder.embedQuery(parsed.skill.trigger);
    } catch (err) {
      this.logger.warn(
        `practice-skill-extract: embedQuery failed для trigger '${parsed.skill.trigger.slice(0, 50)}': ${err instanceof Error ? err.message : String(err)}`,
      );
      triggerEmbedding = null;
    }

    if (triggerEmbedding) {
      const existing = await this.findSimilarSkill({
        tenantId: args.tenantId,
        scope: 'person',
        scopeRefId: args.personId,
        queryVec: triggerEmbedding,
        threshold: this.cfg.practiceSkills.knnDedupThreshold,
      });
      if (existing) {
        const updated = await this.mergeIntoExisting({
          existingId: existing.id,
          draft: parsed.skill,
          conceptId: args.conceptId,
          traitIds: args.personTraits.map((t) => t.id),
          episodeCount: blocks.length,
        });
        this.logger.log(
          `practice-skill-extract: concept=${args.conceptId} person=${args.personId} — merged в existing skill=${existing.id}`,
        );
        return updated;
      }
    }

    const examples = blocks.slice(0, 3).map((b) => ({
      episodeBlockId: b.id,
      outcome: 'pending',
    }));
    const created = await this.prisma.practiceSkill.create({
      data: {
        tenantId: args.tenantId,
        scope: 'person',
        scopeRefId: args.personId,
        trigger: parsed.skill.trigger.slice(0, 200),
        steps: parsed.skill.steps as unknown as object,
        examples: examples as unknown as object,
        redFlags: parsed.skill.redFlags as unknown as object,
        status: 'shadow',
        trafficShare: this.cfg.practiceSkills.shadowTrafficShare,
        derivedFromConceptIds: [args.conceptId],
        derivedFromTraitIds: args.personTraits.map((t) => t.id),
        derivedFromEpisodeCount: blocks.length,
      },
    });
    if (triggerEmbedding && triggerEmbedding.length > 0) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "practice_skills" SET "triggerEmbedding" = $1::vector WHERE id = $2',
          `[${triggerEmbedding.join(',')}]`,
          created.id,
        );
      } catch (err) {
        this.logger.debug(
          `practice-skill-extract: triggerEmbedding upsert failed для skill=${created.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.metrics.incPracticeSkillsExtracted({ scope: 'person' });
    this.logger.log(
      `practice-skill-extract: concept=${args.conceptId} person=${args.personId} → новый skill=${created.id} (confidence=${parsed.confidence})`,
    );
    return created;
  }

  private async findSimilarSkill(args: {
    tenantId: string;
    scope: 'person' | 'role' | 'org';
    scopeRefId: string;
    queryVec: number[];
    threshold: number;
  }): Promise<{ id: string; dist: number } | null> {
    const minDistance = 1 - args.threshold;
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; dist: number }>>(
        `SELECT id, ("triggerEmbedding" <=> $1::vector) AS dist
           FROM "practice_skills"
          WHERE "triggerEmbedding" IS NOT NULL
            AND "tenantId" = $2
            AND "scope"::text = $3
            AND "scopeRefId" = $4
            AND ("triggerEmbedding" <=> $1::vector) <= $5
          ORDER BY dist ASC
          LIMIT 1`,
        `[${args.queryVec.join(',')}]`,
        args.tenantId,
        args.scope,
        args.scopeRefId,
        minDistance,
      );
      const best = rows[0];
      if (!best) return null;
      return { id: best.id, dist: Number(best.dist) };
    } catch (err) {
      this.logger.debug(
        `practice-skill-extract: KNN search failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async mergeIntoExisting(args: {
    existingId: string;
    draft: PracticeSkillDraftFields;
    conceptId: string;
    traitIds: string[];
    episodeCount: number;
  }): Promise<PracticeSkill> {
    const existing = await this.prisma.practiceSkill.findUnique({
      where: { id: args.existingId },
    });
    if (!existing) {
      throw new Error(`existing skill ${args.existingId} disappeared`);
    }
    const conceptIds = uniq([...existing.derivedFromConceptIds, args.conceptId]);
    const traitIds = uniq([...existing.derivedFromTraitIds, ...args.traitIds]);

    return this.prisma.practiceSkill.update({
      where: { id: args.existingId },
      data: {
        derivedFromConceptIds: conceptIds,
        derivedFromTraitIds: traitIds,
        derivedFromEpisodeCount: existing.derivedFromEpisodeCount + args.episodeCount,
        version: existing.version + 1,
      },
    });
  }
}

interface PracticeSkillDraftFields {
  trigger: string;
  steps: Array<{
    order: number;
    action: string;
    emotionalRegister?: string;
    redFlags?: string[];
  }>;
  redFlags: string[];
  reasoning: string;
}

interface PracticeSkillExtractDraft {
  skill: PracticeSkillDraftFields | null;
  confidence: number;
}

function parseDraft(raw: string): PracticeSkillExtractDraft {
  const parsed = JSON.parse(raw) as Partial<{
    skill: unknown;
    confidence: unknown;
  }>;
  const confidence =
    typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
  if (parsed.skill === null || parsed.skill === undefined) {
    return { skill: null, confidence };
  }
  if (typeof parsed.skill !== 'object') {
    throw new Error('skill is not an object');
  }
  const obj = parsed.skill as Record<string, unknown>;
  const trigger = typeof obj.trigger === 'string' ? obj.trigger.trim() : '';
  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning : '';
  const stepsRaw = Array.isArray(obj.steps) ? obj.steps : [];
  const steps = stepsRaw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s, i) => {
      const order = typeof s.order === 'number' && Number.isInteger(s.order) ? s.order : i + 1;
      const action = typeof s.action === 'string' ? s.action.trim() : '';
      const emotionalRegister =
        typeof s.emotionalRegister === 'string' ? s.emotionalRegister : undefined;
      const redFlags = Array.isArray(s.redFlags)
        ? (s.redFlags as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 5)
        : undefined;
      return { order, action, emotionalRegister, redFlags };
    })
    .filter((s) => s.action.length > 0);
  const redFlags = Array.isArray(obj.redFlags)
    ? (obj.redFlags as unknown[]).filter((v): v is string => typeof v === 'string').slice(0, 8)
    : [];

  if (trigger.length < 10 || steps.length < 2) {
    return { skill: null, confidence };
  }
  return {
    skill: { trigger, steps, redFlags, reasoning },
    confidence,
  };
}

function uniq<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}
