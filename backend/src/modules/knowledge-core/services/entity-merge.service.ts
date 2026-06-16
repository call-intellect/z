import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type Entity,
  type EntityType,
  type IdeaBlock,
  Prisma,
} from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import {
  ENTITY_MERGE_ARBITER_JSON_SCHEMA,
  ENTITY_MERGE_ARBITER_SYSTEM_PROMPT,
  EntityMergeArbiterResponseSchema,
} from '../prompts/entity-merge-arbiter.prompt';

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

// Промпт, JSON Schema и Zod вынесены в `prompts/entity-merge-arbiter.prompt.ts`.
// Алиасы под историческими именами — чтобы тело сервиса не менялось.
const ArbiterResponseSchema = EntityMergeArbiterResponseSchema;
const ARBITER_JSON_SCHEMA = ENTITY_MERGE_ARBITER_JSON_SCHEMA;
const ARBITER_SYSTEM_PROMPT = ENTITY_MERGE_ARBITER_SYSTEM_PROMPT;

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

    // ТЗ 2026-05-24 §4 (F1.2) — обернуть user (сущности) в маркеры.
    const guardOn = this.isPromptInjectionGuardEnabled();
    try {
      const out = await this.llm.call({
        taskType: 'entity-merge-arbiter',
        tenantId: args.tenantId,
        systemPrompt: guardOn
          ? withInjectionGuard(ARBITER_SYSTEM_PROMPT)
          : ARBITER_SYSTEM_PROMPT,
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

  /**
   * Org-Admin Фаза 7: ручное слияние двух Entity (без LLM-арбитра).
   *
   * Алгоритм:
   *   1. Загрузить fromEntity / intoEntity. Проверить tenantId match, оба
   *      без mergedIntoId, оба того же type (если разные — ошибка).
   *   2. Транзакция:
   *      - перенос IdeaBlockEntity entityId=fromEntity.id → intoEntity.id;
   *        composite PK (blockId, entityId) — pre-check целевой пары, при
   *        конфликте delete дубля-источника, иначе update (Б1: без catch P2002 в tx).
   *      - перенос EntityLink (fromEntityId / toEntityId) → intoEntity.id;
   *        composite unique — pre-check целевого ключа, при конфликте delete,
   *        иначе update (Б1).
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
        // Б1: pre-check вместо catch(P2002) внутри tx — иначе ошибка SQL
        // абортит всю транзакцию (PostgreSQL 25P02), и перенос/слияние ниже
        // не выполняется. Проверяем целевую пару (blockId, intoEntityId) заранее.
        const conflicting = await tx.ideaBlockEntity.findUnique({
          where: {
            blockId_entityId: { blockId: m.blockId, entityId: intoEntityId },
          },
        });
        if (conflicting) {
          // Уже есть пара (blockId, intoEntityId) — просто удаляем from-запись.
          await tx.ideaBlockEntity.delete({
            where: {
              blockId_entityId: { blockId: m.blockId, entityId: fromEntityId },
            },
          });
        } else {
          await tx.ideaBlockEntity.update({
            where: { blockId_entityId: { blockId: m.blockId, entityId: fromEntityId } },
            data: { entityId: intoEntityId },
          });
        }
      }

      // Перенос EntityLink (входящие).
      const linksTo = await tx.entityLink.findMany({
        where: { toEntityId: fromEntityId },
      });
      for (const l of linksTo) {
        // Б1: pre-check вместо catch(P2002) внутри tx (catch абортил бы
        // транзакцию — PostgreSQL 25P02). findFirst, а не findUnique:
        // composite-ключ включает nullable fromType/toType, вход findUnique
        // их не принимает. id:{not} исключает саму переносимую запись.
        const conflicting = await tx.entityLink.findFirst({
          where: {
            fromEntityId: l.fromEntityId,
            fromType: l.fromType,
            toEntityId: intoEntityId,
            toType: l.toType,
            relationType: l.relationType,
            id: { not: l.id },
          },
        });
        if (conflicting) {
          await tx.entityLink.delete({ where: { id: l.id } });
        } else {
          await tx.entityLink.update({
            where: { id: l.id },
            data: { toEntityId: intoEntityId },
          });
        }
      }
      // Перенос EntityLink (исходящие).
      const linksFrom = await tx.entityLink.findMany({
        where: { fromEntityId: fromEntityId },
      });
      for (const l of linksFrom) {
        // Б1: pre-check вместо catch(P2002) внутри tx (см. выше). findFirst
        // из-за nullable fromType/toType в composite-ключе; id:{not} исключает
        // саму переносимую запись.
        const conflicting = await tx.entityLink.findFirst({
          where: {
            fromEntityId: intoEntityId,
            fromType: l.fromType,
            toEntityId: l.toEntityId,
            toType: l.toType,
            relationType: l.relationType,
            id: { not: l.id },
          },
        });
        if (conflicting) {
          await tx.entityLink.delete({ where: { id: l.id } });
        } else {
          await tx.entityLink.update({
            where: { id: l.id },
            data: { fromEntityId: intoEntityId },
          });
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
