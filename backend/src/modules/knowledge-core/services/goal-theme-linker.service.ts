import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

@Injectable()
export class GoalThemeLinkerService {
  private readonly logger = new Logger(GoalThemeLinkerService.name);

  private static readonly DEFAULT_MIN_WEIGHT = 0.15;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async linkGoalThemes(
    tenantId: string,
    goalId: string,
  ): Promise<{ linked: number; provenance: number; comention: number }> {
    const empty = { linked: 0, provenance: 0, comention: 0 } as const;

    const goal = await this.prisma.goal.findUnique({
      where: { id: goalId },
      select: { tenantId: true, sourceBlockIds: true },
    });
    if (!goal) return empty;
    if (goal.tenantId !== tenantId) return empty;

    const minWeight = this.resolveMinWeight();
    const sourceBlockIds = goal.sourceBlockIds ?? [];

    const candidates = new Map<
      string,
      { themeId: string; weight: number; method: 'provenance' | 'comention' }
    >();
    let provenanceCount = 0;
    let comentionCount = 0;

    if (sourceBlockIds.length > 0) {
      const provenanceRows = await this.prisma.themeIdeaBlock.findMany({
        where: { blockId: { in: sourceBlockIds } },
        select: { themeId: true },
      });
      const provenanceCounts = new Map<string, number>();
      for (const row of provenanceRows) {
        provenanceCounts.set(row.themeId, (provenanceCounts.get(row.themeId) ?? 0) + 1);
      }

      const provenanceThemeIds = [...provenanceCounts.keys()];
      const activeProvenanceIds = await this.filterActiveThemes(tenantId, provenanceThemeIds);

      const blockCount = sourceBlockIds.length;
      for (const themeId of activeProvenanceIds) {
        const hits = provenanceCounts.get(themeId) ?? 0;
        const weight = Math.min(1, hits / blockCount);
        if (weight < minWeight) continue;
        candidates.set(themeId, { themeId, weight, method: 'provenance' });
      }
      provenanceCount = candidates.size;

      const entityRows = await this.prisma.ideaBlockEntity.findMany({
        where: { blockId: { in: sourceBlockIds } },
        select: { entityId: true },
      });
      const entityIds = [...new Set(entityRows.map((r) => r.entityId))];
      if (entityIds.length > 0) {
        const themeEntityRows = await this.prisma.themeEntity.findMany({
          where: { entityId: { in: entityIds } },
          select: { themeId: true, entityId: true },
        });
        const comentionEntities = new Map<string, Set<string>>();
        for (const row of themeEntityRows) {
          let set = comentionEntities.get(row.themeId);
          if (!set) {
            set = new Set<string>();
            comentionEntities.set(row.themeId, set);
          }
          set.add(row.entityId);
        }
        const comentionThemeIds = [...comentionEntities.keys()];
        const activeComentionIds = await this.filterActiveThemes(tenantId, comentionThemeIds);
        const entityCount = entityIds.length;
        for (const themeId of activeComentionIds) {
          if (candidates.has(themeId)) continue;
          const covered = comentionEntities.get(themeId)?.size ?? 0;
          const weight = Math.min(1, covered / entityCount);
          if (weight < minWeight) continue;
          candidates.set(themeId, { themeId, weight, method: 'comention' });
          comentionCount += 1;
        }
      }
    }

    if (candidates.size === 0) {
      const linkedByEmbedding = await this.linkByEmbedding(tenantId, goalId, minWeight);
      return { linked: linkedByEmbedding, provenance: provenanceCount, comention: comentionCount };
    }

    const data = [...candidates.values()].map((c) => ({
      goalId,
      themeId: c.themeId,
      source: 'ai' as const,
      weight: c.weight,
    }));
    const result = await this.prisma.goalTheme.createMany({
      data,
      skipDuplicates: true,
    });

    if (result.count > 0) {
      this.emitMetrics(result.count, provenanceCount, comentionCount);
      await this.coreQueue.enqueueStrategicAlignment({
        tenantId,
        goalId,
        manual: true,
      });
    }

    this.logger.debug(
      {
        goalId,
        tenantId,
        linked: result.count,
        provenance: provenanceCount,
        comention: comentionCount,
      },
      'goal-theme-linker: привязка завершена',
    );

    return {
      linked: result.count,
      provenance: provenanceCount,
      comention: comentionCount,
    };
  }

  private resolveMinWeight(): number {
    try {
      const v = this.cfg.goals.themeAutolinkMinWeight;
      return Number.isFinite(v) ? v : GoalThemeLinkerService.DEFAULT_MIN_WEIGHT;
    } catch {
      return GoalThemeLinkerService.DEFAULT_MIN_WEIGHT;
    }
  }

  private async linkByEmbedding(
    tenantId: string,
    goalId: string,
    minWeight: number,
  ): Promise<number> {
    const maxDistance = this.resolveKnnMaxDistance();
    const topK = this.resolveKnnTopK();
    type Row = { themeId: string; distance: number };
    let rows: Row[];
    try {
      rows = await this.prisma.$queryRaw<Row[]>`
        WITH src AS (
          SELECT embedding FROM "Goal"
          WHERE id = ${goalId} AND "tenantId" = ${tenantId} AND embedding IS NOT NULL
        )
        SELECT t.id AS "themeId",
               (t.embedding <=> (SELECT embedding FROM src))::float AS distance
        FROM "Theme" t
        WHERE t."tenantId" = ${tenantId}
          AND t.status = 'active'
          AND t.embedding IS NOT NULL
          AND EXISTS (SELECT 1 FROM src)
        ORDER BY t.embedding <=> (SELECT embedding FROM src) ASC
        LIMIT ${topK}
      `;
    } catch (err) {
      this.logger.warn(
        { goalId, tenantId, err: err instanceof Error ? err.message : String(err) },
        'goal-theme-linker.linkByEmbedding: SQL упал — пропускаю',
      );
      return 0;
    }
    const data = rows
      .filter((r) => Number.isFinite(r.distance) && r.distance <= maxDistance)
      .map((r) => ({ themeId: r.themeId, weight: Math.min(1, Math.max(0, 1 - r.distance)) }))
      .filter((c) => c.weight >= minWeight)
      .map((c) => ({ goalId, themeId: c.themeId, source: 'ai' as const, weight: c.weight }));
    if (data.length === 0) return 0;
    const result = await this.prisma.goalTheme.createMany({ data, skipDuplicates: true });
    if (result.count > 0) {
      for (let i = 0; i < result.count; i++) {
        this.metrics.incGoalThemeAutolink({ method: 'embedding' });
      }
      await this.coreQueue.enqueueStrategicAlignment({ tenantId, goalId, manual: true });
    }
    return result.count;
  }

  private resolveKnnMaxDistance(): number {
    try {
      const v = this.cfg.goals.themeAutolinkKnnMaxDistance;
      return Number.isFinite(v) ? v : 0.45;
    } catch {
      return 0.45;
    }
  }

  private resolveKnnTopK(): number {
    try {
      const v = Math.trunc(Number(this.cfg.goals.themeAutolinkKnnTopK));
      return Number.isInteger(v) && v > 0 ? v : 5;
    } catch {
      return 5;
    }
  }

  private async filterActiveThemes(tenantId: string, themeIds: string[]): Promise<string[]> {
    if (themeIds.length === 0) return [];
    const rows = await this.prisma.theme.findMany({
      where: { id: { in: themeIds }, tenantId, status: 'active' },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private emitMetrics(linked: number, provenanceCount: number, comentionCount: number): void {
    const provenanceLinked = Math.min(linked, provenanceCount);
    const comentionLinked = Math.min(Math.max(0, linked - provenanceLinked), comentionCount);
    for (let i = 0; i < provenanceLinked; i++) {
      this.metrics.incGoalThemeAutolink({ method: 'provenance' });
    }
    for (let i = 0; i < comentionLinked; i++) {
      this.metrics.incGoalThemeAutolink({ method: 'comention' });
    }
  }
}
