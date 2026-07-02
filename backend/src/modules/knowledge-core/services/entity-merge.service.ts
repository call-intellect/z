import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type Entity,
  type EntityType,
  type IdeaBlock,
  Prisma,
} from '@prisma/client';

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
import {
  ENTITY_MERGE_ARBITER_JSON_SCHEMA,
  ENTITY_MERGE_ARBITER_SYSTEM_PROMPT,
  EntityMergeArbiterResponseSchema,
} from '../prompts/entity-merge-arbiter.prompt';
import { signalTypeLabel } from '../prompts/signal-type-label';

import { markEntityMerged } from './entity-companion.helpers';

/**
 * Человеческие ярлыки вида сущности (Прил. A3): подаём арбитру «человек»,
 * «заказчик», а не код `person`/`customer` — методология промптов №3
 * (человеческий вход). Fallback — сам код.
 */
const ENTITY_TYPE_LABEL_RU: Record<string, string> = {
  person: 'человек',
  customer: 'заказчик',
  vendor: 'поставщик',
  project: 'проект',
  product: 'продукт',
  document: 'документ',
  goal: 'цель',
  event: 'событие',
  topic: 'тема',
  location: 'место',
  technology: 'технология',
  metric: 'показатель',
  market: 'рынок',
  org_unit: 'подразделение',
  client: 'заказчик',
};

function entityTypeLabelRu(code: string): string {
  return ENTITY_TYPE_LABEL_RU[code] ?? code;
}

/**
 * Человеческие ярлыки частых ключей metadata сущности (Прил. A3). Известные
 * ключи переводим, неизвестные — оставляем как есть (не теряем данные).
 */
const ENTITY_METADATA_KEY_LABEL_RU: Record<string, string> = {
  role: 'должность',
  title: 'должность',
  position: 'должность',
  email: 'почта',
  phone: 'телефон',
  inn: 'ИНН',
  domain: 'домен',
  city: 'город',
  codeName: 'кодовое имя',
  code: 'кодовое имя',
  sku: 'артикул',
  article: 'артикул',
};

/**
 * Превращает metadata сущности (произвольный JSON-объект) в человекочитаемые
 * пары «ярлык: значение». Не объект / пусто → null (арбитру нечего показывать).
 */
function humaniseMetadata(
  metadata: unknown,
): Record<string, unknown> | null {
  if (
    metadata == null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return null;
  }
  const entries = Object.entries(metadata as Record<string, unknown>).filter(
    ([, v]) => v != null && v !== '',
  );
  if (entries.length === 0) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const label = ENTITY_METADATA_KEY_LABEL_RU[key] ?? key;
    out[label] = value;
  }
  return out;
}

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
    // Б12 [K5]: dataClass = max по упомянутым блокам обеих сущностей (как
    // делает block-distill через maxDataClass). Без этого арбитр всегда
    // 'internal' → чувствительный контекст уходит провайдеру с меньшим
    // maxDataClass.
    const dataClass = maxDataClass([
      ...args.recentBlocks.map((b) => b.dataClass),
      ...args.candidateRecentBlocks.map((b) => b.dataClass),
    ]);
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
        // Б12 [K5]: явный dataClass — иначе router дефолтит на 'internal'.
        dataClass,
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

  async mergeEntities(args: {
    tenantId: string;
    fromEntityId: string;
    intoEntityId: string;
    actor?: { byUserId?: string; source?: string; explanation?: string };
  }): Promise<{ ok: true }> {
    const { tenantId, fromEntityId, intoEntityId } = args;
    if (fromEntityId === intoEntityId) {
      throw new Error('mergeEntities: fromEntityId === intoEntityId');
    }

    let mergedFromType: EntityType | null = null;

    await this.prisma.$transaction(async (tx) => {
      const [from, into] = await Promise.all([
        tx.entity.findUnique({ where: { id_tenantId: { id: fromEntityId, tenantId } } }),
        tx.entity.findUnique({ where: { id_tenantId: { id: intoEntityId, tenantId } } }),
      ]);
      if (!from) throw new Error(`mergeEntities: Entity не найдена: ${fromEntityId}`);
      if (!into) throw new Error(`mergeEntities: Entity не найдена: ${intoEntityId}`);
      if (from.tenantId !== tenantId || into.tenantId !== tenantId) {
        throw new Error('mergeEntities: tenantId mismatch');
      }
      if (from.mergedIntoId !== null || into.mergedIntoId !== null) {
        throw new Error('mergeEntities: одна из сущностей уже мержена (race)');
      }
      if (from.type !== into.type) {
        throw new Error('mergeEntities: разные type');
      }
      mergedFromType = from.type;

      const mentions = await tx.ideaBlockEntity.findMany({
        where: { entityId: fromEntityId },
      });
      for (const m of mentions) {
        const conflicting = await tx.ideaBlockEntity.findUnique({
          where: {
            blockId_entityId_tenantId: { blockId: m.blockId, entityId: intoEntityId, tenantId },
          },
        });
        if (conflicting) {
          await tx.ideaBlockEntity.delete({
            where: {
              blockId_entityId_tenantId: { blockId: m.blockId, entityId: fromEntityId, tenantId },
            },
          });
        } else {
          await tx.ideaBlockEntity.update({
            where: { blockId_entityId_tenantId: { blockId: m.blockId, entityId: fromEntityId, tenantId } },
            data: { entityId: intoEntityId },
          });
        }
      }

      const linksTo = await tx.entityLink.findMany({
        where: { toEntityId: fromEntityId },
      });
      for (const l of linksTo) {
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
      const linksFrom = await tx.entityLink.findMany({
        where: { fromEntityId: fromEntityId },
      });
      for (const l of linksFrom) {
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

      const sourceRows = await tx.sourceEntity.findMany({
        where: { entityId: fromEntityId, tenantId },
      });
      for (const r of sourceRows) {
        const conflicting = await tx.sourceEntity.findUnique({
          where: { rawEventId_entityId: { rawEventId: r.rawEventId, entityId: intoEntityId } },
        });
        if (conflicting) {
          await tx.sourceEntity.update({
            where: { rawEventId_entityId: { rawEventId: r.rawEventId, entityId: intoEntityId } },
            data: { mentionsCount: { increment: r.mentionsCount } },
          });
          await tx.sourceEntity.delete({
            where: { rawEventId_entityId: { rawEventId: r.rawEventId, entityId: fromEntityId } },
          });
        } else {
          await tx.sourceEntity.update({
            where: { rawEventId_entityId: { rawEventId: r.rawEventId, entityId: fromEntityId } },
            data: { entityId: intoEntityId },
          });
        }
      }

      const themeRows = await tx.themeEntity.findMany({
        where: { entityId: fromEntityId, tenantId },
      });
      for (const r of themeRows) {
        const conflicting = await tx.themeEntity.findUnique({
          where: {
            themeId_entityId_tenantId: { themeId: r.themeId, entityId: intoEntityId, tenantId },
          },
        });
        if (conflicting) {
          await tx.themeEntity.update({
            where: {
              themeId_entityId_tenantId: { themeId: r.themeId, entityId: intoEntityId, tenantId },
            },
            data: { mentionsCount: { increment: r.mentionsCount } },
          });
          await tx.themeEntity.delete({
            where: {
              themeId_entityId_tenantId: { themeId: r.themeId, entityId: fromEntityId, tenantId },
            },
          });
        } else {
          await tx.themeEntity.update({
            where: {
              themeId_entityId_tenantId: { themeId: r.themeId, entityId: fromEntityId, tenantId },
            },
            data: { entityId: intoEntityId },
          });
        }
      }

      await tx.card.updateMany({
        where: { tenantId, entityId: fromEntityId },
        data: { entityId: intoEntityId, entityTenantId: into.tenantId },
      });
      const relatedCards = await tx.card.findMany({
        where: { tenantId, relatedEntityIds: { has: fromEntityId } },
        select: { id: true, relatedEntityIds: true },
      });
      for (const c of relatedCards) {
        const next = Array.from(
          new Set(
            c.relatedEntityIds.map((id) => (id === fromEntityId ? intoEntityId : id)),
          ),
        );
        await tx.card.update({
          where: { id: c.id },
          data: { relatedEntityIds: next },
        });
      }

      await tx.person.updateMany({
        where: { tenantId, entityId: fromEntityId },
        data: { entityId: intoEntityId, entityTenantId: into.tenantId },
      });

      await tx.entity.updateMany({
        where: { tenantId, mergedIntoId: fromEntityId },
        data: { mergedIntoId: intoEntityId, mergedIntoTenantId: into.tenantId },
      });

      const aliasesUnion = Array.from(
        new Set([
          ...into.aliases,
          from.canonicalName,
          ...from.aliases,
        ]),
      );
      await tx.entity.update({
        where: { id_tenantId: { id: intoEntityId, tenantId } },
        data: {
          mentionsCount: into.mentionsCount + from.mentionsCount,
          aliases: aliasesUnion,
        },
      });

      await markEntityMerged(
        tx,
        { id: fromEntityId, tenantId },
        { id: intoEntityId, tenantId: into.tenantId },
      );
    });

    const typedSubrecordCount = await this.countTypedSubrecords(tenantId, fromEntityId);
    if (typedSubrecordCount > 0) {
      this.logger.warn(
        { fromEntityId, intoEntityId, type: mergedFromType },
        'entity-merge: слиты сущности с типизированным сабрекордом — возможен over-merge (вне scope миграции)',
      );
    }

    this.logger.log(
      {
        tenantId,
        fromEntityId,
        intoEntityId,
        byUserId: args.actor?.byUserId,
        source: args.actor?.source,
      },
      'entity-merge: слияние применено',
    );
    return { ok: true };
  }

  async mergeManually(args: {
    tenantId: string;
    fromEntityId: string;
    intoEntityId: string;
    byUserId: string;
  }): Promise<{ ok: true }> {
    return this.mergeEntities({
      tenantId: args.tenantId,
      fromEntityId: args.fromEntityId,
      intoEntityId: args.intoEntityId,
      actor: { byUserId: args.byUserId },
    });
  }

  private async countTypedSubrecords(tenantId: string, entityId: string): Promise<number> {
    const counts = await Promise.all([
      this.prisma.vendor.count({ where: { tenantId, entityId } }),
      this.prisma.customer.count({ where: { tenantId, entityId } }),
      this.prisma.event.count({ where: { tenantId, entityId } }),
      this.prisma.goal.count({ where: { tenantId, entityId } }),
      this.prisma.document.count({ where: { tenantId, entityId } }),
      this.prisma.market.count({ where: { tenantId, entityId } }),
      this.prisma.orgUnit.count({ where: { tenantId, entityId } }),
      this.prisma.role.count({ where: { tenantId, entityId } }),
      this.prisma.department.count({ where: { tenantId, entityId } }),
    ]);
    return counts.reduce((sum, c) => sum + c, 0);
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
      // Прил. A3: подаём ЧЕЛОВЕЧЕСКИЕ ярлыки (вид сущности, тип упоминания,
      // человекочитаемые свойства), а не машинные коды — методология №3.
      вид: entityTypeLabelRu(e.type),
      название: e.canonicalName,
      другиеНаписания: e.aliases,
      свойства: humaniseMetadata(e.metadata),
      числоУпоминаний: e.mentionsCount,
      недавниеУпоминания: recentBlocks.slice(0, 5).map((b) => ({
        блок: b.name,
        вопрос: b.criticalQuestion,
        типСигнала: signalTypeLabel(b.signalType),
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
