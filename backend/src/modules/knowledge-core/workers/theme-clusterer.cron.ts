import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import {
  ClusteringService,
  type ClusterableBlock,
} from '../services/clustering.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';
import { ThemeClassificationService } from '../services/theme-classification.service';

/**
 * ThemeClustererCron — каждый час в :15 проходится по активным Org'ам,
 * кластеризует canonical-блоки без темы по эмбеддингам, и для каждого
 * устойчивого кластера (≥ THEME_CLUSTER_MIN_SIZE) — создаёт `Theme`
 * с привязкой блоков и сущностей.
 *
 * Алгоритм на тик (для Org с ≥ THEME_CLUSTERING_MIN_BLOCKS блоков без темы):
 *   1. Загрузить до MAX_BLOCKS_PER_ORG canonical-блоков, у которых нет
 *      записи в ThemeIdeaBlock и есть embedding.
 *   2. ClusteringService.clusterByEmbedding(threshold, minSize) → массив
 *      кластеров.
 *   3. Для каждого кластера:
 *      - Подгрузить top-N entities по mentionsCount через IdeaBlockEntity.
 *      - LLM-вызов theme-classify → {name, description, branch, tags, weight, confidence}.
 *      - Embed `name + ' ' + description` через KnowledgeEmbeddingService.
 *      - Создать Theme + ThemeIdeaBlock × N + ThemeEntity × M.
 *
 * NB: cron-expression в декораторе литерален (`'15 * * * *'`).
 *
 * Сложность: O(B²) cosine на Org (B ≤ MAX_BLOCKS_PER_ORG=1000) → ~1.5s
 * worst-case. На больших Org заменить на pgvector-side query.
 */
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
      this.logger.log(summary, 'theme-clusterer: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'theme-clusterer: непойманная ошибка — повтор через час',
      );
    }
  }

  /** Public для возможного админ-эндпоинта / ручного запуска. */
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

    // Org-Admin Фаза 7: тумблер. Если выключено — skip Org молча.
    try {
      await this.gate.checkOrThrow(tenantId, 'theme-clusterer');
    } catch {
      this.logger.debug({ tenantId }, 'theme-clusterer: gate disabled — skip Org');
      return 0;
    }

    // Сколько canonical-блоков без темы. Считаем «по факту присутствия» через
    // raw SQL — count(IdeaBlock) where status='canonical' AND NOT EXISTS
    // (ThemeIdeaBlock by blockId).
    const candidateCountRows = await this.prisma.$queryRawUnsafe<
      Array<{ count: bigint }>
    >(
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

    // Тащим эмбеддинги через сырой SQL (Prisma не умеет vector). Embedding
    // приходит как float8[] в PostgreSQL — но pg-driver Prisma приведёт его
    // к строке вида "[0.1,0.2,...]". Парсим явно.
    const blockRows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; embedding: string }>
    >(
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

    this.logger.log(
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

  /**
   * Создаёт Theme по списку blockIds кластера. Возвращает id созданной темы
   * или null, если LLM/embedding отказали.
   */
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

    // Top-N entities по mentionsCount среди этих блоков.
    const entityRows = await this.prisma.ideaBlockEntity.findMany({
      where: { blockId: { in: blocks.map((b) => b.id) } },
      include: {
        entity: { select: { id: true, canonicalName: true, type: true, mentionsCount: true } },
      },
    });
    // Считаем сколько раз каждая Entity встретилась в блоках кластера.
    const entityMentionsByEntity = new Map<string, number>();
    const entityMeta = new Map<
      string,
      { id: string; canonicalName: string; type: import('@prisma/client').EntityType }
    >();
    for (const row of entityRows) {
      const e = row.entity;
      entityMentionsByEntity.set(
        e.id,
        (entityMentionsByEntity.get(e.id) ?? 0) + 1,
      );
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

    const theme = await this.prisma.theme.create({
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

    if (embedding && embedding.length > 0) {
      try {
        await this.prisma.$executeRawUnsafe(
          'UPDATE "Theme" SET embedding = $1::vector(1536) WHERE id = $2',
          toVectorLiteral(embedding),
          theme.id,
        );
      } catch (err) {
        this.logger.warn(
          {
            themeId: theme.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'theme-clusterer: не удалось записать embedding темы — продолжаю',
        );
      }
    }

    if (blocks.length > 0) {
      await this.prisma.themeIdeaBlock.createMany({
        data: blocks.map((b) => ({
          themeId: theme.id,
          blockId: b.id,
          weight: new Prisma.Decimal('1.000'),
        })),
        skipDuplicates: true,
      });
    }
    if (topEntities.length > 0) {
      await this.prisma.themeEntity.createMany({
        data: topEntities.map((e) => ({
          themeId: theme.id,
          entityId: e.id,
          mentionsCount: entityMentionsByEntity.get(e.id) ?? 0,
        })),
        skipDuplicates: true,
      });
    }

    return theme.id;
  }
}

/**
 * pgvector ::text возвращает строку вида `[0.123,-0.456,...]`. Превращаем
 * в `number[]`. На любую кривизну — null.
 */
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
