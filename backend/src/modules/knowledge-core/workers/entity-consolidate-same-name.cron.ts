import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Entity, IdeaBlock } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { WorkerDisabledForOrgError, WorkerOrgGate } from '../../core-queue/worker-org-gate';
import { EntityMergeService } from '../services/entity-merge.service';
import { EntityResolutionService } from '../services/entity-resolution.service';
import { resolveCanonicalType } from '../services/entity-type-priority';

interface ConsolidateCounters {
  groups: number;
  merged: number;
  distinct: number;
  errors: number;
}

interface SameNameGroupRow {
  lname: string;
  ids: string[];
}

interface ConsolidateSummary {
  scannedOrgs: number;
  groups: number;
  merged: number;
  distinct: number;
  errors: number;
}

@Injectable()
export class EntityConsolidateSameNameCronService {
  private readonly logger = new Logger(EntityConsolidateSameNameCronService.name);
  private static readonly WORKER_NAME = 'entity-consolidate-same-name';
  private static readonly MAX_MEMBERS_PER_GROUP = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(EntityMergeService) private readonly merger: EntityMergeService,
    @Inject(EntityResolutionService) private readonly resolution: EntityResolutionService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  @Cron('40 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'entity-consolidate-same-name: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'entity-consolidate-same-name: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(dryRun = false): Promise<ConsolidateSummary> {
    const enabled = await this.cfg
      .getDynamic<boolean>('knowledge.entityConsolidateSameNameEnabled', undefined, true)
      .catch(() => true);
    if (!enabled) {
      this.logger.debug('entity-consolidate-same-name отключён');
      return { scannedOrgs: 0, groups: 0, merged: 0, distinct: 0, errors: 0 };
    }

    const batchSize = await this.cfg
      .getDynamic<number>('knowledge.entityConsolidateSameNameBatchSize', undefined, 200)
      .catch(() => 200);

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    const counters: ConsolidateCounters = { groups: 0, merged: 0, distinct: 0, errors: 0 };
    let scannedOrgs = 0;

    for (const org of orgs) {
      try {
        await this.gate.checkOrThrow(org.id, EntityConsolidateSameNameCronService.WORKER_NAME);
      } catch (err) {
        if (err instanceof WorkerDisabledForOrgError) continue;
        throw err;
      }
      try {
        await this.consolidateOrg(org.id, batchSize, counters, dryRun);
        scannedOrgs++;
      } catch (err) {
        counters.errors++;
        this.logger.warn(
          { tenantId: org.id, err: err instanceof Error ? err.message : String(err) },
          'entity-consolidate-same-name: ошибка на Org — продолжаю',
        );
      }
    }

    return {
      scannedOrgs,
      groups: counters.groups,
      merged: counters.merged,
      distinct: counters.distinct,
      errors: counters.errors,
    };
  }

  async runForOneOrg(
    tenantId: string,
    batchSize: number,
    dryRun = false,
  ): Promise<ConsolidateSummary> {
    const enabled = await this.cfg
      .getDynamic<boolean>('knowledge.entityConsolidateSameNameEnabled', undefined, true)
      .catch(() => true);
    if (!enabled) {
      this.logger.debug('entity-consolidate-same-name отключён');
      return { scannedOrgs: 0, groups: 0, merged: 0, distinct: 0, errors: 0 };
    }

    try {
      await this.gate.checkOrThrow(tenantId, EntityConsolidateSameNameCronService.WORKER_NAME);
    } catch (err) {
      if (err instanceof WorkerDisabledForOrgError) {
        return { scannedOrgs: 0, groups: 0, merged: 0, distinct: 0, errors: 0 };
      }
      throw err;
    }

    const counters: ConsolidateCounters = { groups: 0, merged: 0, distinct: 0, errors: 0 };
    await this.consolidateOrg(tenantId, batchSize, counters, dryRun);

    return {
      scannedOrgs: 1,
      groups: counters.groups,
      merged: counters.merged,
      distinct: counters.distinct,
      errors: counters.errors,
    };
  }

  async consolidateOrg(
    tenantId: string,
    batchSize: number,
    counters: ConsolidateCounters,
    dryRun = false,
  ): Promise<void> {
    const groups = await this.prisma.$queryRawUnsafe<SameNameGroupRow[]>(
      `
      SELECT LOWER("canonicalName") AS lname,
             array_agg(id ORDER BY "mentionsCount" DESC, "createdAt" ASC) AS ids
      FROM "Entity"
      WHERE "tenantId" = $1 AND "mergedIntoId" IS NULL AND type <> 'person'
      GROUP BY LOWER("canonicalName")
      HAVING COUNT(*) > 1
      LIMIT $2
      `,
      tenantId,
      batchSize,
    );

    for (const group of groups) {
      counters.groups++;
      if (dryRun) continue;
      try {
        await this.consolidateGroup(tenantId, group.ids, counters);
      } catch (err) {
        counters.errors++;
        this.logger.warn(
          {
            tenantId,
            lname: group.lname,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-consolidate-same-name: группа пропущена',
        );
      }
    }
  }

  private async consolidateGroup(
    tenantId: string,
    ids: string[],
    counters: ConsolidateCounters,
  ): Promise<void> {
    const [canonicalId, ...restIds] = ids;
    if (!canonicalId || restIds.length === 0) return;

    const loadedCanonical = await this.prisma.entity.findFirst({
      where: { id: canonicalId, tenantId },
    });
    if (!loadedCanonical || loadedCanonical.mergedIntoId !== null) return;

    let canonical: Entity = loadedCanonical;
    let canonicalRecentBlocks = await this.loadRecentBlocks(canonical.id);

    const boundedRestIds = restIds.slice(
      0,
      EntityConsolidateSameNameCronService.MAX_MEMBERS_PER_GROUP - 1,
    );
    for (const fromId of boundedRestIds) {
      const from = await this.prisma.entity.findFirst({ where: { id: fromId, tenantId } });
      if (!from || from.mergedIntoId !== null) continue;

      const distinct = await this.resolution
        .isEntityPairDistinct(from.id, canonical.id)
        .catch(() => false);
      if (distinct) continue;

      const recentBlocks = await this.loadRecentBlocks(from.id);
      const verdict = await this.merger.judgeMerge({
        tenantId,
        entity: from,
        candidate: canonical,
        recentBlocks,
        candidateRecentBlocks: canonicalRecentBlocks,
      });

      if (verdict.verdict === 'distinct') {
        await this.resolution.markEntityPairDistinct(from.id, canonical.id).catch(() => undefined);
        counters.distinct++;
        continue;
      }

      if (verdict.canonicalId !== canonical.id) {
        this.logger.debug(
          { tenantId, fromEntityId: from.id, canonicalId: canonical.id, chosen: verdict.canonicalId },
          'entity-consolidate-same-name: merge с иным каноном — пропуск без negative-cache',
        );
        continue;
      }

      const r = resolveCanonicalType(from.type, canonical.type);
      const canonicalType = 'type' in r ? r.type : (verdict.canonicalType ?? canonical.type);

      try {
        await this.merger.mergeEntities({
          tenantId,
          fromEntityId: from.id,
          intoEntityId: canonical.id,
          canonicalType,
          actor: { source: 'same-name-consolidator', explanation: verdict.explanation },
        });
        counters.merged++;
        const refreshed = await this.prisma.entity.findFirst({
          where: { id: canonical.id, tenantId },
        });
        if (refreshed) {
          canonical = refreshed;
          canonicalRecentBlocks = await this.loadRecentBlocks(canonical.id);
        }
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            fromEntityId: from.id,
            intoEntityId: canonical.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-consolidate-same-name: merge пропущен (already-merged race)',
        );
      }
    }
  }

  private async loadRecentBlocks(entityId: string): Promise<IdeaBlock[]> {
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: { entityId },
      include: { block: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return rows.map((r) => r.block);
  }
}
