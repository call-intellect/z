import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Entity,
  type EntityType,
  type IdeaBlock,
  Prisma,
} from '@prisma/client';
import { z } from 'zod';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';

/**
 * Кандидат для merge'а Entity — другая сущность того же tenant'а / type,
 * у которой cosine-similarity к исходной выше порога.
 */
export interface EntityMergeCandidate {
  candidate: Entity;
  similarity: number;
}

/**
 * Вердикт LLM-арбитра. При `merge` `canonicalId` обязателен и должен быть
 * id одного из переданных кандидатов.
 */
export type EntityMergeVerdict =
  | { verdict: 'merge'; canonicalId: string; explanation: string }
  | { verdict: 'distinct'; explanation: string };

/**
 * Сырая запись из $queryRawUnsafe — все поля Entity + similarity.
 * embedding / metadata намеренно не выбираем (чтобы не таскать по сети vector).
 */
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

const ArbiterResponseSchema = z.object({
  verdict: z.enum(['merge', 'distinct']),
  canonicalId: z.string().optional(),
  explanation: z.string(),
});

const ARBITER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'explanation'],
  properties: {
    verdict: { type: 'string', enum: ['merge', 'distinct'] },
    canonicalId: { type: 'string' },
    explanation: { type: 'string' },
  },
};

const ARBITER_SYSTEM_PROMPT = `Ты — арбитр дубликатов сущностей в knowledge-core.
Получаешь одну "новую" сущность и до 5 кандидатов того же типа (того же tenant'а), ближайших по эмбеддингу.
Решаешь: новая сущность — это другое написание / алиас одного из кандидатов (verdict="merge"), или это другая сущность (verdict="distinct").

Правила:
- Учитывай metadata: для type=person — должность/email/телефон; для type=client — ИНН/домен/город; для type=project — кодовое имя; для type=product — артикул/SKU.
- НЕ сливай однофамильцев из разных компаний (если metadata явно разделяет — distinct).
- НЕ сливай разные продукты с похожими именами в разных проектах.
- Учитывай контекст блоков (recentMentions[]) — если новая сущность и кандидат упоминаются в одних и тех же блоках/контекстах, это сильный сигнал к merge.
- Если merge — поле "canonicalId" обязательно (id одного из переданных кандидатов).
- Если distinct — "canonicalId" не указывай.
- "explanation" — короткое объяснение в 1-2 предложениях, на русском.
- Ответ — строго JSON по схеме. Никакого markdown.`;

/**
 * EntityMergeService — KNN cosine + LLM-арбитр для entity-resolver worker'а.
 *
 *   - `findCandidates(tenantId, entityId, threshold)` — pgvector cosine KNN
 *     среди Entity того же tenantId / type / status (mergedIntoId IS NULL).
 *     Возвращает только тех, у кого similarity > threshold. Limit 5.
 *   - `judgeMerge` — LLM-вызов `taskType: 'entity-merge-arbiter'` с JSON
 *     Schema strict. На вход — обе сущности + контекст 3-5 последних блоков
 *     каждой (через IdeaBlockEntity).
 */
@Injectable()
export class EntityMergeService {
  private readonly logger = new Logger(EntityMergeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  async findCandidates(args: {
    tenantId: string;
    entityId: string;
    threshold: number;
  }): Promise<EntityMergeCandidate[]> {
    // Cosine: `<=>` в pgvector — distance, [0..2]. similarity = 1 - distance ∈ [-1..1];
    // для нормированных эмбеддингов text-embedding-3-small — фактически [0..1].
    //
    // Жёсткий фильтр: type должен совпадать (нельзя слить person и client),
    // mergedIntoId IS NULL (не берём «уже мерженных»),
    // id <> entityId (себя не тащим).
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

    try {
      const out = await this.llm.call({
        taskType: 'entity-merge-arbiter',
        tenantId: args.tenantId,
        systemPrompt: ARBITER_SYSTEM_PROMPT,
        userMessage,
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

  /**
   * Org-Admin Фаза 7: ручное слияние двух Entity (без LLM-арбитра).
   *
   * Алгоритм:
   *   1. Загрузить fromEntity / intoEntity. Проверить tenantId match, оба
   *      без mergedIntoId, оба того же type (если разные — ошибка).
   *   2. Транзакция:
   *      - перенос IdeaBlockEntity entityId=fromEntity.id → intoEntity.id;
   *        composite PK (blockId, entityId) — try update, на P2002 → delete.
   *      - перенос EntityLink (fromEntityId / toEntityId) → intoEntity.id;
   *        unique (fromEntityId, toEntityId, relationType) — try update,
   *        на P2002 → delete.
   *      - intoEntity.mentionsCount += fromEntity.mentionsCount,
   *        aliases = union(into.aliases, [from.canonicalName, ...from.aliases]),
   *        updatedAt=now.
   *      - fromEntity: mergedIntoId=intoEntity.id, updatedAt=now.
   *   3. Лог + AuditLog (на Фазе 7 пишет caller, не сервис).
   */
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
      // Перенос IdeaBlockEntity. composite PK (blockId, entityId).
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
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            // Уже есть пара (blockId, intoEntityId) — просто удаляем from-запись.
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

      // Перенос EntityLink (входящие).
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
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            await tx.entityLink.delete({ where: { id: l.id } });
          } else {
            throw err;
          }
        }
      }
      // Перенос EntityLink (исходящие).
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
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            await tx.entityLink.delete({ where: { id: l.id } });
          } else {
            throw err;
          }
        }
      }

      // Обновляем intoEntity (mentionsCount, aliases).
      const aliasesUnion = Array.from(
        new Set([
          ...intoEntity.aliases,
          fromEntity.canonicalName,
          ...fromEntity.aliases,
        ]),
      );
      await tx.entity.update({
        where: { id: intoEntityId },
        data: {
          mentionsCount: intoEntity.mentionsCount + fromEntity.mentionsCount,
          aliases: aliasesUnion,
        },
      });

      // fromEntity → merged_into.
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

  // ─────────────────────────── helpers ─────────────────────────────────────

  private parseVerdict(
    text: string,
    candidates: Entity[],
  ): EntityMergeVerdict | null {
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

  private summariseEntity(
    e: Entity,
    recentBlocks: IdeaBlock[],
  ): Record<string, unknown> {
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
