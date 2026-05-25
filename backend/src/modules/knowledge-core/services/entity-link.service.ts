import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type EntityLink,
  type EntityLinkType,
  type LinkCreatedBy,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * KC-Temporal W3.1 (2026-05-25) — Rich edges на `EntityLink`.
 *
 * Ребро — не голый `(from, to, type)`, а сущность с атрибутами:
 *   - `attributes` — семантически богатые данные ребра (role / share / since /
 *     intensity / ... — то, что извлёк LLM `entity-graph-builder`).
 *   - `sourceBlockIds` — IdeaBlock'и-источники (для трассировки + калибровки
 *     `confidence`).
 *   - `validFrom` / `validUntil` — временные рамки действия ребра (bi-temporal
 *     KC-Temporal волна 1).
 *
 * Единая точка upsert'а — этот сервис. При повторном вызове (другой батч
 * блоков подтвердил то же ребро) — sourceBlockIds объединяются (union),
 * confidence берётся как max, attributes мерджатся плоско (новые ключи +
 * перезапись существующих).
 *
 * legacy-вызовы `prisma.entityLink.create / update` остаются валидны: новые
 * поля nullable (`attributes`) или дефолтные (`sourceBlockIds = []`).
 */
@Injectable()
export class EntityLinkService {
  private readonly logger = new Logger(EntityLinkService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Upsert ребра с rich-edge атрибутами по composite-key
   * `(fromEntityId, fromType, toEntityId, toType, relationType)`.
   *
   * Поведение update'а:
   *   - `confidence` → max(существующее, новое).
   *   - `sourceBlockIds` → union (Set по обеим строкам).
   *   - `attributes` → плоский merge (новые ключи + перезапись существующих).
   *     null/undefined игнорируется (не обнуляет существующие attributes).
   *   - `validFrom` / `validUntil` — переписываются, если переданы (caller
   *     явно решил обновить временные рамки).
   *   - `explanation` → перезаписывается (последнее LLM-обоснование победило).
   *   - `status` всегда выставляется в `'active'` (re-upsert «оживляет»
   *     ребро после soft-delete).
   *
   * Все merge-операции делаются в одной транзакции — между read и write
   * запись могла обновиться, но `upsert` с уникальным ключом сериализует
   * на стороне Postgres. Чтение «текущего» состояния — внутри транзакции.
   */
  async upsertRichEdge(args: {
    tenantId: string;
    fromEntityId: string;
    toEntityId: string;
    fromType?: string | null;
    toType?: string | null;
    relationType: EntityLinkType;
    confidence: number;
    explanation: string;
    createdBy: LinkCreatedBy;
    attributes?: Record<string, string | number | boolean | null> | null;
    sourceBlockIds?: ReadonlyArray<string>;
    validFrom?: Date | null;
    validUntil?: Date | null;
  }): Promise<EntityLink> {
    const fromType = args.fromType ?? 'entity';
    const toType = args.toType ?? 'entity';
    const newConfDec = new Prisma.Decimal(args.confidence.toFixed(3));
    const newAttributes = sanitizeAttributes(args.attributes);
    const newSources = uniqueStrings(args.sourceBlockIds ?? []);

    return this.prisma.$transaction(async (tx) => {
      // Существующее ребро (если есть) — для merge'а sourceBlockIds /
      // confidence / attributes.
      const existing = await tx.entityLink.findUnique({
        where: {
          fromEntityId_fromType_toEntityId_toType_relationType: {
            fromEntityId: args.fromEntityId,
            fromType,
            toEntityId: args.toEntityId,
            toType,
            relationType: args.relationType,
          },
        },
      });

      if (!existing) {
        return tx.entityLink.create({
          data: {
            tenantId: args.tenantId,
            fromEntityId: args.fromEntityId,
            fromType,
            toEntityId: args.toEntityId,
            toType,
            relationType: args.relationType,
            confidence: newConfDec,
            explanation: args.explanation,
            createdBy: args.createdBy,
            status: 'active',
            attributes: newAttributes ?? Prisma.JsonNull,
            sourceBlockIds: newSources,
            ...(args.validFrom !== undefined && args.validFrom !== null
              ? { validFrom: args.validFrom }
              : {}),
            ...(args.validUntil !== undefined
              ? { validUntil: args.validUntil }
              : {}),
          },
        });
      }

      // Merge с существующим:
      //   confidence → max
      const existingConf = numberFromDecimal(existing.confidence);
      const mergedConf = Math.max(existingConf, args.confidence);
      const mergedConfDec = new Prisma.Decimal(mergedConf.toFixed(3));

      //   sourceBlockIds → union
      const mergedSources = uniqueStrings([
        ...existing.sourceBlockIds,
        ...newSources,
      ]);

      //   attributes → плоский merge (новые ключи + перезапись существующих).
      const mergedAttributes = mergeAttributes(
        existing.attributes as unknown,
        newAttributes,
      );

      return tx.entityLink.update({
        where: { id: existing.id },
        data: {
          confidence: mergedConfDec,
          explanation: args.explanation,
          sourceBlockIds: mergedSources,
          attributes:
            mergedAttributes === null
              ? Prisma.JsonNull
              : (mergedAttributes as Prisma.InputJsonValue),
          status: 'active',
          // validFrom/validUntil — переписываются ТОЛЬКО при явной передаче.
          // undefined ⇒ оставляем как есть.
          ...(args.validFrom !== undefined && args.validFrom !== null
            ? { validFrom: args.validFrom }
            : {}),
          ...(args.validUntil !== undefined
            ? { validUntil: args.validUntil }
            : {}),
        },
      });
    });
  }
}

// ─────────────────────────── helpers ───────────────────────────

/**
 * Узкая sanitation для attributes: оставляем только примитивы
 * (string | number | boolean | null). Объекты/массивы — отбрасываем (LLM
 * иногда возвращает вложенные структуры — для rich-edge MVP они не нужны).
 */
function sanitizeAttributes(
  attrs: Record<string, string | number | boolean | null> | null | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!attrs || typeof attrs !== 'object') return null;
  const out: Record<string, string | number | boolean | null> = {};
  let count = 0;
  for (const [k, v] of Object.entries(attrs)) {
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out[k] = v;
      count += 1;
    }
  }
  if (count === 0) return null;
  return out;
}

/**
 * Плоский merge attributes:
 *   - existing — текущее значение из Prisma (Json), может быть object|null|array.
 *   - incoming — sanitized новый объект, либо null (нет новых атрибутов).
 *
 * Если оба null — возвращаем null. Если incoming null — оставляем existing.
 * Если existing не object/null — заменяем на incoming (legacy badness).
 */
function mergeAttributes(
  existing: unknown,
  incoming: Record<string, string | number | boolean | null> | null,
): Record<string, string | number | boolean | null> | null {
  if (!incoming) {
    // Возвращаем existing как есть (если он валидный object).
    if (
      existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing)
    ) {
      return existing as Record<string, string | number | boolean | null>;
    }
    return null;
  }
  if (
    !existing ||
    typeof existing !== 'object' ||
    Array.isArray(existing)
  ) {
    return incoming;
  }
  return {
    ...(existing as Record<string, string | number | boolean | null>),
    ...incoming,
  };
}

function uniqueStrings(arr: ReadonlyArray<string>): string[] {
  return [...new Set(arr)];
}

function numberFromDecimal(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof (v as { toString?: () => string }).toString === 'function') {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
