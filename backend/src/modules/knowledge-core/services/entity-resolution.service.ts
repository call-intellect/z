import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Entity, type EntityType, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

/**
 * EntityResolutionService (Шаг 2 baseline):
 *
 *   - findOrCreate по `(tenantId, type, lower(canonicalName))`.
 *   - На повторное упоминание — `mentionsCount += 1`, метаданные мерджатся
 *     (новые ключи добавляются, старые — не перезаписываются).
 *   - На создание — генерим embedding (через `KnowledgeEmbeddingService`)
 *     и кладём через сырой $executeRaw (Prisma не умеет тип vector).
 *
 * LLM-арбитражная дедупликация дубликатов с разными вариантами написания —
 * Шаг 4 (`entity-resolver.worker`). Здесь же — простая нормализация имени.
 */
@Injectable()
export class EntityResolutionService {
  private readonly logger = new Logger(EntityResolutionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  async findOrCreateEntity(args: {
    tenantId: string;
    type: EntityType;
    name: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ entity: Entity; created: boolean }> {
    const normalized = args.name.trim();
    if (normalized.length === 0) {
      throw new Error('EntityResolution: пустое имя сущности');
    }
    const lowered = normalized.toLowerCase();

    // findFirst по (tenantId, type) + ручная фильтрация по lower(canonicalName).
    // На больших тенантах это упрётся — Шаг 4 заменит на ts_vector + KNN.
    // Сейчас экономим инфраструктуру, индекс @@index([tenantId, canonicalName])
    // даёт seq scan по типу-тенанту + bytewise фильтр.
    const candidates = await this.prisma.entity.findMany({
      where: { tenantId: args.tenantId, type: args.type, mergedIntoId: null },
      select: { id: true, canonicalName: true, metadata: true, mentionsCount: true },
    });
    const found = candidates.find(
      (c) => c.canonicalName.trim().toLowerCase() === lowered,
    );
    if (found) {
      const mergedMeta = this.mergeMetadata(found.metadata, args.metadata);
      const updated = await this.prisma.entity.update({
        where: { id: found.id },
        data: {
          mentionsCount: { increment: 1 },
          ...(mergedMeta !== undefined ? { metadata: mergedMeta } : {}),
        },
      });
      return { entity: updated, created: false };
    }

    // Создаём новую entity. Embedding кладётся вторым шагом — через executeRaw.
    const created = await this.prisma.entity.create({
      data: {
        tenantId: args.tenantId,
        type: args.type,
        canonicalName: normalized,
        mentionsCount: 1,
        metadata: (args.metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    try {
      const [vec] = await this.embeddings.embedEntityNames([normalized]);
      if (vec) {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Entity" SET embedding = $1::vector(1536) WHERE id = $2',
          this.toVectorLiteral(vec),
          created.id,
        );
      }
    } catch (err) {
      this.logger.warn(
        {
          entityId: created.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity: не удалось проставить embedding — продолжаем без него',
      );
    }
    return { entity: created, created: true };
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  /**
   * Мерджит metadata: существующие ключи остаются как есть, новые ключи
   * из `incoming` добавляются. Если оба null — возвращает undefined,
   * чтобы caller не трогал поле.
   */
  private mergeMetadata(
    existing: Prisma.JsonValue | null,
    incoming: Record<string, unknown> | undefined,
  ): Prisma.InputJsonValue | undefined {
    if (!incoming || Object.keys(incoming).length === 0) return undefined;
    const base =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    let changed = false;
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(incoming)) {
      if (!(k in merged)) {
        merged[k] = v;
        changed = true;
      }
    }
    return changed ? (merged as Prisma.InputJsonValue) : undefined;
  }

  /**
   * Postgres pgvector литерал: `[0.1,0.2,...]`.
   */
  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }
}
