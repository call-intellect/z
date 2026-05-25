import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type Entity,
  type EntityLinkType,
  type IdeaBlock,
} from '@prisma/client';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  LlmRouterService,
  maxDataClass,
} from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';

/**
 * Результат LLM-арбитра для пары сущностей.
 *   - `'none'` → relationType = null.
 *   - Иначе — конкретный тип из enum'а EntityLinkType.
 */
export interface EntityRelationVerdict {
  relationType: EntityLinkType | null;
  confidence: number;
  explanation: string;
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
  required: ['relationType', 'confidence', 'explanation'],
  properties: {
    relationType: {
      type: 'string',
      enum: [...ENTITY_LINK_TYPES, 'none'],
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    explanation: { type: 'string', maxLength: 500 },
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
- Ответ — строго JSON по схеме. Никакого markdown.`;

/**
 * EntityGraphService — поиск co-mentioned пар сущностей + LLM-арбитр для
 * `entity-graph-builder.cron`.
 *
 *   - `findCoMentionedPairs`: пары Entity одного tenant'а, упомянутые в одном
 *     IdeaBlock хотя бы N раз (порог `ENTITY_GRAPH_MIN_COMENTIONS`).
 *   - `judgeRelation`: один LLM-вызов на пару с подгруженными последними
 *     блоками для контекста.
 */
@Injectable()
export class EntityGraphService {
  private readonly logger = new Logger(EntityGraphService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
  ) {}

  /**
   * ТЗ 2026-05-24 §4 (F1.2) — мастер-флаг защиты от prompt-injection.
   */
  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  /**
   * Возвращает топ-N пар сущностей одного tenant'а, отсортированных по
   * количеству совместных упоминаний (через canonical-блоки). Антидубль
   * по `a.id < b.id`.
   */
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
      // Игнорируем merged_into-сущности — связь должна быть на canonical.
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

  /**
   * Подтянуть последние N IdeaBlock'ов, где упомянуты обе сущности.
   * Используется как контекст для LLM-арбитра.
   */
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

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (сущности + блоки) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
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
        // Фаза 11: dataClass — max по упомянутым блокам.
        dataClass: maxDataClass(args.recentBlocks.map((b) => b.dataClass)),
      });
      const parsed = this.parseVerdict(out.text);
      if (parsed) return parsed;
      this.logger.warn(
        { aId: args.entityA.id, bId: args.entityB.id },
        'entity-graph-builder: invalid JSON LLM-арбитра — fallback на none',
      );
      return { relationType: null, confidence: 0, explanation: 'invalid LLM judge JSON' };
    } catch (err) {
      this.logger.warn(
        {
          aId: args.entityA.id,
          bId: args.entityB.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-graph-builder: LLM judge упал — fallback на none',
      );
      return { relationType: null, confidence: 0, explanation: 'LLM judge call failed' };
    }
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  private parseVerdict(text: string): EntityRelationVerdict | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
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
