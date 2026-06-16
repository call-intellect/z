import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { type Entity, type EntityLinkType, type IdeaBlock } from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';

export interface EntityRelationVerdict {
  relationType: EntityLinkType | null;
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

const ENTITY_LINK_TYPES: EntityLinkType[] = [
  'works_at',
  'belongs_to',
  'part_of',
  'opposes',
  'depends_on',
  'mentions_with',
];

const ENTITY_LINK_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'relationType',
    'confidence',
    'explanation',
    'validFromHint',
    'validUntilHint',
    'attributes',
  ],
  properties: {
    relationType: {
      type: 'string',
      enum: [...ENTITY_LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
    validFromHint: { type: ['string', 'null'], maxLength: 40 },
    validUntilHint: { type: ['string', 'null'], maxLength: 40 },
    attributes: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: {
            anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }],
          },
        },
      ],
    },
  },
};

const EntityLinkResponseSchema = z.object({
  relationType: z.enum([
    'works_at',
    'belongs_to',
    'part_of',
    'opposes',
    'depends_on',
    'mentions_with',
    'none',
  ]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(500),
  validFromHint: z.string().max(40).nullable().optional(),
  validUntilHint: z.string().max(40).nullable().optional(),
  attributes: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .nullable()
    .optional(),
});

const ENTITY_LINK_SYSTEM_PROMPT = `Ты — эксперт по связям между сущностями (клиенты, люди, проекты, продукты, темы).
На вход даются две сущности A и B + несколько последних блоков (фактов знания), где они упомянуты вместе.

Твоя задача: определить, есть ли между A и B явное отношение, и если да — какого типа.

Возможные типы (выбирай один):
- "works_at" — A работает в B (или наоборот). Обычно person<>client/project/product.
- "belongs_to" — A принадлежит / относится к B.
- "part_of" — A — часть B (компонент, подпроект, член команды).
- "opposes" — A противопоставлено B (конкурент, спорная сторона).
- "depends_on" — A зависит от B (без B не работает).
- "mentions_with" — A и B регулярно упоминаются вместе, но более конкретного отношения не видно.
- "none" — связи нет, совместное упоминание случайно.

Правила:
- Если из контекста блоков НЕ видно явного отношения, ставь "none". "mentions_with" — последний резерв, когда ясно, что они связаны, но как именно — непонятно.
- "confidence" ∈ [0,1]. 0.9+ только если связь прямо названа в блоках.
- "explanation" — 1-2 короткие фразы на русском.
- "validFromHint" / "validUntilHint" — ISO-дата (YYYY-MM-DD или YYYY-MM или YYYY), если в блоках явно указано «с такого-то момента» / «до такого-то момента». Иначе null. Не выдумывай.
- "attributes" — плоский объект с дополнительными свойствами связи (role, share, since, intensity и т.п.), если они явно названы в блоках. Иначе null. Только примитивы (строки/числа/булевы). Не выдумывай.
- Ответ — строго JSON по схеме. Никакого markdown.`;

@Injectable()
export class EntityGraphService {
  private readonly logger = new Logger(EntityGraphService.name);

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
      GROUP BY a."entityId", b."entityId"
      HAVING COUNT(*) >= $2
      ORDER BY COUNT(*) DESC
      LIMIT $3
      `,
      args.tenantId,
      args.minComentions,
      args.limit,
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
    return { relationType: null, confidence: 0, explanation: 'invalid LLM judge JSON' };
  }

  private parseVerdict(text: string): EntityRelationVerdict | null {
    const raw = tryParseJson(text);
    const parsed = EntityLinkResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    if (parsed.data.relationType === 'none') {
      return {
        relationType: null,
        confidence: parsed.data.confidence,
        explanation: parsed.data.explanation,
      };
    }
    return {
      relationType: parsed.data.relationType,
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
