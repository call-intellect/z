import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { type EntityType, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { ClusteringService, type ClusterableBlock } from '../services/clustering.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';
import { ThemeClassificationService } from '../services/theme-classification.service';

@Injectable()
export class ThemeClustererCron {
  private readonly logger = new Logger(ThemeClustererCron.name);
  private static readonly MAX_BLOCKS_PER_ORG = 1000;
  private static readonly TOP_ENTITIES_PER_CLUSTER = 10;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ClusteringService) private readonly clustering: ClusteringService,
    @Inject(ThemeClassificationService)
    private readonly classifier: ThemeClassificationService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron('15 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'theme-clusterer: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'theme-clusterer: непойманная ошибка — повтор через час',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    clusteredOrgs: number;
    createdThemes: number;
  }> {
    const minBlocks = this.cfg.knowledgeCore.themeClusteringMinBlocks;
    const minClusterSize = this.cfg.knowledgeCore.themeClusterMinSize;
    const cosineThreshold = this.cfg.knowledgeCore.themeCosineThreshold;

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    let clusteredOrgs = 0;
    let createdThemes = 0;

    for (const org of orgs) {
      try {
        const created = await this.runForOrg({
          tenantId: org.id,
          minBlocks,
          minClusterSize,
          cosineThreshold,
        });
        if (created > 0) {
          clusteredOrgs += 1;
          createdThemes += created;
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-clusterer: ошибка на Org — продолжаю',
        );
      }
    }

    return { scannedOrgs: orgs.length, clusteredOrgs, createdThemes };
  }

  private async runForOrg(args: {
    tenantId: string;
    minBlocks: number;
    minClusterSize: number;
    cosineThreshold: number;
  }): Promise<number> {
    const { tenantId, minBlocks, minClusterSize, cosineThreshold } = args;

    try {
      await this.gate.checkOrThrow(tenantId, 'theme-clusterer');
    } catch {
      this.logger.debug({ tenantId }, 'theme-clusterer: gate disabled — skip Org');
      return 0;
    }

    const candidateCountRows = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `
      SELECT COUNT(*)::bigint AS count
        FROM "IdeaBlock" b
       WHERE b."tenantId" = $1
         AND b.status = 'canonical'
         AND b.embedding IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "ThemeIdeaBlock" t WHERE t."blockId" = b.id
         )
      `,
      tenantId,
    );
    const candidateCount = Number(candidateCountRows[0]?.count ?? 0n);
    if (candidateCount < minBlocks) return 0;

    const blockRows = await this.prisma.$queryRawUnsafe<Array<{ id: string; embedding: string }>>(
      `
      SELECT b.id AS id, b.embedding::text AS embedding
        FROM "IdeaBlock" b
       WHERE b."tenantId" = $1
         AND b.status = 'canonical'
         AND b.embedding IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM "ThemeIdeaBlock" t WHERE t."blockId" = b.id
         )
       ORDER BY b."createdAt" ASC
       LIMIT $2
      `,
      tenantId,
      ThemeClustererCron.MAX_BLOCKS_PER_ORG,
    );
    const clusterables: ClusterableBlock[] = [];
    for (const row of blockRows) {
      const vec = parseVector(row.embedding);
      if (!vec) continue;
      clusterables.push({ id: row.id, embedding: vec });
    }
    if (clusterables.length < minClusterSize) return 0;

    const clusters = this.clustering.clusterByEmbedding(
      clusterables,
      cosineThreshold,
      minClusterSize,
    );
    if (clusters.length === 0) {
      this.logger.debug(
        { tenantId, blocks: clusterables.length },
        'theme-clusterer: устойчивых кластеров не нашлось',
      );
      return 0;
    }

    let created = 0;
    for (const cluster of clusters) {
      try {
        const themeId = await this.materializeCluster({
          tenantId,
          blockIds: cluster.blockIds,
        });
        if (themeId) created += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            clusterSize: cluster.blockIds.length,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-clusterer: ошибка на кластере — продолжаю',
        );
      }
    }

    this.logger.debug(
      {
        tenantId,
        candidateBlocks: clusterables.length,
        clusters: clusters.length,
        createdThemes: created,
      },
      'theme-clusterer: org обработан',
    );
    return created;
  }

  private async materializeCluster(args: {
    tenantId: string;
    blockIds: string[];
  }): Promise<string | null> {
    const { tenantId, blockIds } = args;
    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds }, tenantId, status: 'canonical' },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        trustedAnswer: true,
        signalType: true,
        tags: true,
        dataClass: true,
      },
    });
    if (blocks.length === 0) return null;

    const entityRows = await this.prisma.ideaBlockEntity.findMany({
      where: { blockId: { in: blocks.map((b) => b.id) } },
      include: {
        entity: { select: { id: true, canonicalName: true, type: true, mentionsCount: true } },
      },
    });
    const entityMentionsByEntity = new Map<string, number>();
    const entityMeta = new Map<string, { id: string; canonicalName: string; type: EntityType }>();
    for (const row of entityRows) {
      const e = row.entity;
      entityMentionsByEntity.set(e.id, (entityMentionsByEntity.get(e.id) ?? 0) + 1);
      if (!entityMeta.has(e.id)) {
        entityMeta.set(e.id, {
          id: e.id,
          canonicalName: e.canonicalName,
          type: e.type,
        });
      }
    }
    const topEntities = [...entityMentionsByEntity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, ThemeClustererCron.TOP_ENTITIES_PER_CLUSTER)
      .map(([id]) => entityMeta.get(id))
      .filter((x): x is NonNullable<typeof x> => x !== undefined);

    const classification = await this.classifier.classifyTheme({
      tenantId,
      blocks,
      entities: topEntities,
    });
    if (!classification) {
      this.logger.warn(
        { tenantId, blocksInCluster: blocks.length },
        'theme-clusterer: classifier вернул null — пропускаем кластер',
      );
      return null;
    }

    const embeddingText = `${classification.name} ${classification.description}`.trim();
    const embedding = await this.embeddings.embedQuery(embeddingText);

    // Б10 [K10] — гард уникальности «блок ↔ Theme». PK ThemeIdeaBlock —
    // (themeId, blockId), т.е. он НЕ уникален по blockId: один блок мог бы
    // попасть в несколько Theme. Кандидаты выбирались SELECT'ом с
    // `NOT EXISTS ThemeIdeaBlock`, но между ним и записью был долгий LLM-вызов
    // (classifyTheme) — параллельный тик другого Org/прохода мог уже забрать
    // часть блоков. Решение: внутри одной транзакции пере-проверяем, какие из
    // блоков кластера ВСЁ ЕЩЁ свободны (NOT EXISTS), создаём Theme и пишем
    // ThemeIdeaBlock только по ним. Если не осталось ни одного свободного —
    // тему не создаём (иначе родится пустая осиротевшая Theme).
    const blockIdsInCluster = blocks.map((b) => b.id);
    const themeId = await this.prisma.$transaction(async (tx) => {
      const freeRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT b.id AS id
           FROM "IdeaBlock" b
          WHERE b."tenantId" = $1
            AND b.id = ANY($2::text[])
            AND NOT EXISTS (
              SELECT 1 FROM "ThemeIdeaBlock" t WHERE t."blockId" = b.id
            )`,
        tenantId,
        blockIdsInCluster,
      );
      const freeBlockIds = new Set(freeRows.map((r) => r.id));
      if (freeBlockIds.size === 0) {
        this.logger.debug(
          { tenantId, clusterBlocks: blocks.length },
          'theme-clusterer: все блоки кластера уже привязаны к темам — пропускаем',
        );
        return null;
      }

      const created = await tx.theme.create({
        data: {
          tenantId,
          name: classification.name,
          description: classification.description,
          branch: classification.branch,
          weight: new Prisma.Decimal(classification.weight.toFixed(3)),
          confidence: new Prisma.Decimal(classification.confidence.toFixed(3)),
          status: 'active',
          lastSignalAt: new Date(),
        },
        select: { id: true },
      });

      await tx.themeIdeaBlock.createMany({
        data: blocks
          .filter((b) => freeBlockIds.has(b.id))
          .map((b) => ({
            themeId: created.id,
            blockId: b.id,
            weight: new Prisma.Decimal('1.000'),
          })),
        skipDuplicates: true,
      });
      if (topEntities.length > 0) {
        await tx.themeEntity.createMany({
          data: topEntities.map((e) => ({
            themeId: created.id,
            entityId: e.id,
            mentionsCount: entityMentionsByEntity.get(e.id) ?? 0,
          })),
          skipDuplicates: true,
        });
      }
      return created.id;
    });

    if (!themeId) return null;

    if (embedding && embedding.length > 0) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Theme" SET embedding = $1::vector(1536) WHERE id = $2',
          toVectorLiteral(embedding),
          themeId,
        );
      } catch (err) {
        this.logger.warn(
          {
            themeId,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-clusterer: не удалось записать embedding темы — продолжаю',
        );
      }
    }

    return themeId;
  }
}

function parseVector(raw: string | null): number[] | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return null;
  const parts = inner.split(',');
  const out = new Array<number>(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const n = Number.parseFloat(parts[i]!);
    if (!Number.isFinite(n)) return null;
    out[i] = n;
  }
  return out;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
