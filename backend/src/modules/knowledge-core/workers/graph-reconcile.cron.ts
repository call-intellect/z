import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { EntityLinkType } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { GraphService } from '../../../common/graph/graph.service';
import type { NodeType } from '../../../common/graph/graph.types';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface ReconcileCounters {
  mergedEdges: number;
  deletedEdges: number;
  deletedNodes: number;
  skipped: number;
}

interface ActiveLinkRow {
  id: string;
  fromEntityId: string;
  fromType: string | null;
  toEntityId: string;
  toType: string | null;
  relationType: EntityLinkType;
  confidence: unknown;
  validFrom: Date | null;
  validTo: Date | null;
}

@Injectable()
export class GraphReconcileCronService {
  private readonly logger = new Logger(GraphReconcileCronService.name);
  private static readonly MAX_ACTIVE_PAGES = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(GraphService) private readonly graph: GraphService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('25 * * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'graph-reconcile: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'graph-reconcile: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    mergedEdges: number;
    deletedEdges: number;
    deletedNodes: number;
    skipped: number;
  }> {
    const enabled = await this.cfg
      .getDynamic<boolean>('knowledge.graphReconcileEnabled', undefined, true)
      .catch(() => true);
    if (!enabled) {
      this.logger.debug('graph-reconcile отключён');
      return { scannedOrgs: 0, mergedEdges: 0, deletedEdges: 0, deletedNodes: 0, skipped: 0 };
    }

    const batchSize = await this.cfg
      .getDynamic<number>('knowledge.graphReconcileBatchSize', undefined, 500)
      .catch(() => 500);

    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    const counters: ReconcileCounters = {
      mergedEdges: 0,
      deletedEdges: 0,
      deletedNodes: 0,
      skipped: 0,
    };

    for (const org of orgs) {
      try {
        await this.reconcileOrg(org.id, batchSize, counters);
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'graph-reconcile: ошибка на Org — продолжаю',
        );
      }
    }

    return {
      scannedOrgs: orgs.length,
      mergedEdges: counters.mergedEdges,
      deletedEdges: counters.deletedEdges,
      deletedNodes: counters.deletedNodes,
      skipped: counters.skipped,
    };
  }

  async reconcileOrg(
    tenantId: string,
    batchSize: number,
    counters: ReconcileCounters,
  ): Promise<void> {
    let cursorId: string | null = null;
    for (let page = 0; page < GraphReconcileCronService.MAX_ACTIVE_PAGES; page++) {
      const links: ActiveLinkRow[] = await this.prisma.entityLink.findMany({
        where: { tenantId, status: 'active' },
        select: {
          id: true,
          fromEntityId: true,
          fromType: true,
          toEntityId: true,
          toType: true,
          relationType: true,
          confidence: true,
          validFrom: true,
          validTo: true,
        },
        orderBy: { id: 'asc' },
        take: batchSize,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      if (links.length === 0) break;
      cursorId = links[links.length - 1]!.id;

      for (const link of links) {
        try {
          await this.graph.mergeEdgeGraphOnly({
            tenantId,
            from: { type: (link.fromType ?? 'entity') as NodeType, id: link.fromEntityId },
            to: { type: (link.toType ?? 'entity') as NodeType, id: link.toEntityId },
            linkType: link.relationType,
            confidence: link.confidence != null ? Number(link.confidence) : undefined,
            validFrom: link.validFrom ?? undefined,
            validTo: link.validTo ?? undefined,
          });
          counters.mergedEdges++;
          this.metrics.incGraphReconcileMerged({ type: 'entityLink' });
        } catch (err) {
          counters.skipped++;
          this.logger.debug(
            {
              linkId: link.id,
              relationType: link.relationType,
              err: err instanceof Error ? err.message : String(err),
            },
            'graph-reconcile: ребро пропущено (неизвестный тип/AGE-сбой)',
          );
        }
      }

      if (links.length < batchSize) break;
    }

    const archived = await this.prisma.entityLink.findMany({
      where: { tenantId, status: 'archived' },
      select: {
        id: true,
        fromEntityId: true,
        fromType: true,
        toEntityId: true,
        toType: true,
        relationType: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: batchSize,
    });
    for (const link of archived) {
      try {
        await this.graph.deleteEdgeGraphOnly({
          tenantId,
          from: { type: (link.fromType ?? 'entity') as NodeType, id: link.fromEntityId },
          to: { type: (link.toType ?? 'entity') as NodeType, id: link.toEntityId },
          linkType: link.relationType,
        });
        counters.deletedEdges++;
        this.metrics.incGraphReconcileDeleted({ type: 'entityLink' });
      } catch (err) {
        this.logger.debug(
          {
            linkId: link.id,
            relationType: link.relationType,
            err: err instanceof Error ? err.message : String(err),
          },
          'graph-reconcile: удаление архивного ребра пропущено (AGE-сбой)',
        );
      }
    }

    const mergedAway = await this.prisma.entity.findMany({
      where: { tenantId, mergedIntoId: { not: null } },
      select: { id: true },
      take: batchSize,
    });
    for (const entity of mergedAway) {
      try {
        await this.graph.deleteNodeGraphOnly({ tenantId, type: 'entity', id: entity.id });
        counters.deletedNodes++;
        this.metrics.incGraphReconcileDeleted({ type: 'entity' });
      } catch (err) {
        this.logger.debug(
          {
            entityId: entity.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'graph-reconcile: удаление merged-away узла пропущено (AGE-сбой)',
        );
      }
    }
  }
}
