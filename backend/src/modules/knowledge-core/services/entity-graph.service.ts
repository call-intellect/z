import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Entity, type EntityLinkType, type IdeaBlock } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import {
  ENTITY_LINK_JSON_SCHEMA,
  ENTITY_LINK_SYSTEM_PROMPT,
  EntityLinkResponseSchema,
  type EntityLinkDirection,
} from '../prompts/entity-graph-builder.prompt';

export interface EntityRelationVerdict {
  relationType: EntityLinkType | null;
  direction: EntityLinkDirection;
  confidence: number;
  explanation: string;
  validFromHint?: string | null;
  validUntilHint?: string | null;
  attributes?: Record<string, string | number | boolean | null> | null;
}

export interface CoMentionedPair {
  entityA: Entity;
  entityB: Entity;
  coMentions: number;
}

@Injectable()
export class EntityGraphService {
  private readonly logger = new Logger(EntityGraphService.name);

  /**
   * Б30 [K6]: пара исключается из выборки, если уже есть EntityLink между ней,
   * обновлённый за последние N дней. Без этого cron ежечасно re-LLM'ит топ-50
   * пар даже при существующей свежей связи (~1200 вызовов/сутки/Org). 30 дней —
   * связь подтверждена недавно, переспрашивать арбитра незачем.
   */
  private static readonly LINK_REFRESH_DAYS = 30;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async findCoMentionedPairs(args: {
    tenantId: string;
    minComentions: number;
    limit: number;
  }): Promise<CoMentionedPair[]> {
    const linkFreshCutoff = new Date(
      Date.now() -
        EntityGraphService.LINK_REFRESH_DAYS * 24 * 60 * 60 * 1000,
    );
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        a_id: string;
        b_id: string;
        co_mentions: bigint | number | string;
      }>
    >(
      `
      SELECT a."entityId" AS a_id,
             b."entityId" AS b_id,
             COUNT(*)::bigint AS co_mentions
      FROM "IdeaBlockEntity" a
      JOIN "IdeaBlockEntity" b
        ON a."blockId" = b."blockId"
       AND a."entityId" < b."entityId"
      JOIN "IdeaBlock" blk ON blk.id = a."blockId"
      WHERE blk."tenantId" = $1
        AND blk.status = 'canonical'
        AND NOT EXISTS (
          SELECT 1 FROM "EntityLink" el
          WHERE el."tenantId" = $1
            AND (
              (el."fromEntityId" = a."entityId" AND el."toEntityId" = b."entityId")
              OR (el."fromEntityId" = b."entityId" AND el."toEntityId" = a."entityId")
            )
            AND el."deletedAt" IS NULL
            AND el."updatedAt" > $4
        )
      GROUP BY a."entityId", b."entityId"
      HAVING COUNT(*) >= $2
      ORDER BY COUNT(*) DESC
      LIMIT $3
      `,
      args.tenantId,
      args.minComentions,
      args.limit,
      linkFreshCutoff,
    );
    if (rows.length === 0) return [];

    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.a_id);
      ids.add(r.b_id);
    }
    const entities = await this.prisma.entity.findMany({
      where: { id: { in: Array.from(ids) } },
    });
    const map = new Map(entities.map((e) => [e.id, e]));

    const pairs: CoMentionedPair[] = [];
    for (const r of rows) {
      const a = map.get(r.a_id);
      const b = map.get(r.b_id);
      if (!a || !b) continue;
      if (a.mergedIntoId !== null || b.mergedIntoId !== null) continue;
      const coMentions =
        typeof r.co_mentions === 'bigint'
          ? Number(r.co_mentions)
          : typeof r.co_mentions === 'string'
            ? Number(r.co_mentions)
            : r.co_mentions;
      pairs.push({ entityA: a, entityB: b, coMentions });
    }
    return pairs;
  }

  async findRecentSharedBlocks(args: {
    entityAId: string;
    entityBId: string;
    limit: number;
  }): Promise<IdeaBlock[]> {
    return this.prisma.ideaBlock.findMany({
      where: {
        status: 'canonical',
        AND: [
          { entities: { some: { entityId: args.entityAId } } },
          { entities: { some: { entityId: args.entityBId } } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: args.limit,
    });
  }

  async judgeRelation(args: {
    tenantId: string;
    entityA: Entity;
    entityB: Entity;
    recentBlocks: IdeaBlock[];
  }): Promise<EntityRelationVerdict> {
    const userPayload = {
      entityA: this.summariseEntity(args.entityA),
      entityB: this.summariseEntity(args.entityB),
      recentBlocks: args.recentBlocks.map((b) => ({
        name: b.name,
        criticalQuestion: b.criticalQuestion,
        trustedAnswer: b.trustedAnswer,
      })),
    };
    const userMessage = `Сущности A и B + контекст блоков ниже. Определи отношение (или "none").\n\n${JSON.stringify(userPayload, null, 2)}`;

    const guardOn = this.isPromptInjectionGuardEnabled();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'entity-graph-builder',
          tenantId: args.tenantId,
          systemPrompt: guardOn
            ? withInjectionGuard(ENTITY_LINK_SYSTEM_PROMPT)
            : ENTITY_LINK_SYSTEM_PROMPT,
          userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
          responseFormat: {
            type: 'json_schema',
            name: 'EntityGraphBuilderVerdict',
            strict: true,
            schema: ENTITY_LINK_JSON_SCHEMA,
          },
          sourceRef: { type: 'entity', id: args.entityA.id },
          dataClass: maxDataClass(args.recentBlocks.map((b) => b.dataClass)),
          validate: (text) => this.parseVerdict(text) !== null,
        });
        const parsed = this.parseVerdict(out.text);
        if (parsed) return parsed;
        this.metrics?.incKcEntityGraphInvalidJson?.({ reason: 'parse' });
        this.logger.warn(
          { aId: args.entityA.id, bId: args.entityB.id, attempt },
          'entity-graph-builder: invalid JSON LLM-арбитра — повтор',
        );
      } catch (err) {
        this.metrics?.incKcEntityGraphInvalidJson?.({ reason: 'llm_error' });
        this.logger.warn(
          {
            aId: args.entityA.id,
            bId: args.entityB.id,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-graph-builder: LLM judge упал — повтор',
        );
      }
    }

    this.metrics?.incKcEntityGraphFallbackNone?.({ reason: 'exhausted' });
    this.logger.warn(
      { aId: args.entityA.id, bId: args.entityB.id },
      'entity-graph-builder: fallback на none после 2 попыток',
    );
    return {
      relationType: null,
      direction: 'a_to_b',
      confidence: 0,
      explanation: 'invalid LLM judge JSON',
    };
  }

  private parseVerdict(text: string): EntityRelationVerdict | null {
    const raw = tryParseJson(text);
    const parsed = EntityLinkResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.relationType === 'none') {
      return {
        relationType: null,
        direction: 'a_to_b',
        confidence: parsed.data.confidence,
        explanation: parsed.data.explanation,
      };
    }
    return {
      relationType: parsed.data.relationType,
      direction: parsed.data.direction,
      confidence: parsed.data.confidence,
      explanation: parsed.data.explanation,
      validFromHint: parsed.data.validFromHint ?? null,
      validUntilHint: parsed.data.validUntilHint ?? null,
      attributes: parsed.data.attributes ?? null,
    };
  }

  private summariseEntity(e: Entity): Record<string, unknown> {
    return {
      id: e.id,
      type: e.type,
      canonicalName: e.canonicalName,
      aliases: e.aliases,
      metadata: e.metadata,
      mentionsCount: e.mentionsCount,
    };
  }
}
