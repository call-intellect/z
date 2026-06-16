import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Entity, type EntityType, type IdeaBlock, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  ENTITY_MERGE_ARBITER_JSON_SCHEMA,
  ENTITY_MERGE_ARBITER_SYSTEM_PROMPT,
  EntityMergeArbiterResponseSchema,
} from '../prompts/entity-merge-arbiter.prompt';

export interface EntityMergeCandidate {
  candidate: Entity;
  similarity: number;
}

export type EntityMergeVerdict =
  | { verdict: 'merge'; canonicalId: string; explanation: string }
  | { verdict: 'distinct'; explanation: string };

interface RawCandidateRow {
  id: string;
  tenantId: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mergedIntoId: string | null;
  mentionsCount: number;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
  similarity: string | number;
}

const ArbiterResponseSchema = EntityMergeArbiterResponseSchema;
const ARBITER_JSON_SCHEMA = ENTITY_MERGE_ARBITER_JSON_SCHEMA;
const ARBITER_SYSTEM_PROMPT = ENTITY_MERGE_ARBITER_SYSTEM_PROMPT;

@Injectable()
export class EntityMergeService {
  private readonly logger = new Logger(EntityMergeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
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

  async findCandidates(args: {
    tenantId: string;
    entityId: string;
    threshold: number;
  }): Promise<EntityMergeCandidate[]> {
    const rows = await this.prisma.$queryRawUnsafe<RawCandidateRow[]>(
      `
      SELECT e.id, e."tenantId", e.type, e."canonicalName", e.aliases,
             e."mergedIntoId", e."mentionsCount", e.metadata,
             e."createdAt", e."updatedAt",
             1 - (e.embedding <=> (
               SELECT embedding FROM "Entity" WHERE id = $2
             )::vector(1536)) AS similarity
      FROM "Entity" e
      WHERE e."tenantId" = $1
        AND e.id <> $2
        AND e."mergedIntoId" IS NULL
        AND e.embedding IS NOT NULL
        AND e.type = (SELECT type FROM "Entity" WHERE id = $2)
      ORDER BY e.embedding <=> (
        SELECT embedding FROM "Entity" WHERE id = $2
      )::vector(1536)
      LIMIT 5
      `,
      args.tenantId,
      args.entityId,
    );

    const result: EntityMergeCandidate[] = [];
    for (const r of rows) {
      const sim = typeof r.similarity === 'string' ? Number(r.similarity) : r.similarity;
      if (!Number.isFinite(sim)) continue;
      if (sim <= args.threshold) continue;
      result.push({
        candidate: this.rowToEntity(r),
        similarity: sim,
      });
    }
    return result;
  }

  async judgeMerge(args: {
    tenantId: string;
    entity: Entity;
    candidate: Entity;
    recentBlocks: IdeaBlock[];
    candidateRecentBlocks: IdeaBlock[];
  }): Promise<EntityMergeVerdict> {
    const userPayload = {
      newEntity: this.summariseEntity(args.entity, args.recentBlocks),
      candidate: this.summariseEntity(args.candidate, args.candidateRecentBlocks),
    };
    const userMessage = `Новая сущность и кандидат ниже. Реши verdict.\n\n${JSON.stringify(userPayload, null, 2)}`;

    const guardOn = this.isPromptInjectionGuardEnabled();
    try {
      const out = await this.llm.call({
        taskType: 'entity-merge-arbiter',
        tenantId: args.tenantId,
        systemPrompt: guardOn ? withInjectionGuard(ARBITER_SYSTEM_PROMPT) : ARBITER_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'EntityMergeVerdict',
          strict: true,
          schema: ARBITER_JSON_SCHEMA,
        },
        sourceRef: { type: 'entity', id: args.entity.id },
      });
      const parsed = this.parseVerdict(out.text, [args.candidate]);
      if (parsed) return parsed;
      this.logger.warn(
        { entityId: args.entity.id },
        'entity-merge: invalid arbiter JSON — fallback на distinct',
      );
      return { verdict: 'distinct', explanation: 'invalid LLM arbiter JSON' };
    } catch (err) {
      this.logger.warn(
        {
          entityId: args.entity.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-merge: LLM arbiter упал — fallback на distinct',
      );
      return { verdict: 'distinct', explanation: 'LLM arbiter call failed' };
    }
  }

  async mergeManually(args: {
    tenantId: string;
    fromEntityId: string;
    intoEntityId: string;
    byUserId: string;
  }): Promise<{ ok: true }> {
    const { tenantId, fromEntityId, intoEntityId } = args;
    if (fromEntityId === intoEntityId) {
      throw new Error('mergeManually: fromEntityId === intoEntityId');
    }

    const [fromEntity, intoEntity] = await Promise.all([
      this.prisma.entity.findUnique({ where: { id: fromEntityId } }),
      this.prisma.entity.findUnique({ where: { id: intoEntityId } }),
    ]);
    if (!fromEntity) throw new Error(`Entity not found: ${fromEntityId}`);
    if (!intoEntity) throw new Error(`Entity not found: ${intoEntityId}`);
    if (fromEntity.tenantId !== tenantId || intoEntity.tenantId !== tenantId) {
      throw new Error('mergeManually: tenantId mismatch');
    }
    if (fromEntity.mergedIntoId !== null || intoEntity.mergedIntoId !== null) {
      throw new Error('mergeManually: одна из сущностей уже мержена');
    }
    if (fromEntity.type !== intoEntity.type) {
      throw new Error('mergeManually: разные type');
    }

    await this.prisma.$transaction(async (tx) => {
      const mentions = await tx.ideaBlockEntity.findMany({
        where: { entityId: fromEntityId },
      });
      for (const m of mentions) {
        try {
          await tx.ideaBlockEntity.update({
            where: { blockId_entityId: { blockId: m.blockId, entityId: fromEntityId } },
            data: { entityId: intoEntityId },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await tx.ideaBlockEntity.delete({
              where: {
                blockId_entityId: { blockId: m.blockId, entityId: fromEntityId },
              },
            });
          } else {
            throw err;
          }
        }
      }

      const linksTo = await tx.entityLink.findMany({
        where: { toEntityId: fromEntityId },
      });
      for (const l of linksTo) {
        try {
          await tx.entityLink.update({
            where: { id: l.id },
            data: { toEntityId: intoEntityId },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await tx.entityLink.delete({ where: { id: l.id } });
          } else {
            throw err;
          }
        }
      }
      const linksFrom = await tx.entityLink.findMany({
        where: { fromEntityId: fromEntityId },
      });
      for (const l of linksFrom) {
        try {
          await tx.entityLink.update({
            where: { id: l.id },
            data: { fromEntityId: intoEntityId },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await tx.entityLink.delete({ where: { id: l.id } });
          } else {
            throw err;
          }
        }
      }

      const aliasesUnion = Array.from(
        new Set([...intoEntity.aliases, fromEntity.canonicalName, ...fromEntity.aliases]),
      );
      await tx.entity.update({
        where: { id: intoEntityId },
        data: {
          mentionsCount: intoEntity.mentionsCount + fromEntity.mentionsCount,
          aliases: aliasesUnion,
        },
      });

      await tx.entity.update({
        where: { id: fromEntityId },
        data: { mergedIntoId: intoEntityId },
      });
    });

    this.logger.log(
      {
        tenantId,
        fromEntityId,
        intoEntityId,
        byUserId: args.byUserId,
      },
      'entity-merge: ручное слияние применено',
    );
    return { ok: true };
  }

  private parseVerdict(text: string, candidates: Entity[]): EntityMergeVerdict | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = ArbiterResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.verdict === 'distinct') {
      return { verdict: 'distinct', explanation: parsed.data.explanation };
    }
    const canonicalId = parsed.data.canonicalId;
    if (!canonicalId) return null;
    if (!candidates.some((c) => c.id === canonicalId)) {
      this.logger.warn(
        { canonicalId, candidateIds: candidates.map((c) => c.id) },
        'entity-merge: LLM выбрал id не из списка — трактуем как distinct',
      );
      return null;
    }
    return {
      verdict: 'merge',
      canonicalId,
      explanation: parsed.data.explanation,
    };
  }

  private summariseEntity(e: Entity, recentBlocks: IdeaBlock[]): Record<string, unknown> {
    return {
      id: e.id,
      type: e.type,
      canonicalName: e.canonicalName,
      aliases: e.aliases,
      metadata: e.metadata ?? null,
      mentionsCount: e.mentionsCount,
      recentMentions: recentBlocks.slice(0, 5).map((b) => ({
        name: b.name,
        criticalQuestion: b.criticalQuestion,
        signalType: b.signalType,
      })),
    };
  }

  private rowToEntity(r: RawCandidateRow): Entity {
    return {
      id: r.id,
      tenantId: r.tenantId,
      type: r.type as EntityType,
      canonicalName: r.canonicalName,
      aliases: r.aliases,
      mergedIntoId: r.mergedIntoId,
      mentionsCount: r.mentionsCount,
      embedding: null,
      metadata: r.metadata,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    } as unknown as Entity;
  }
}
