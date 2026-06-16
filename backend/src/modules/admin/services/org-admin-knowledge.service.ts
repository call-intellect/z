import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import { EntityMergeService } from '../../knowledge-core/services/entity-merge.service';

import { AdminCacheService } from './admin-cache.service';

@Injectable()
export class OrgAdminKnowledgeService {
  private readonly logger = new Logger(OrgAdminKnowledgeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntityMergeService) private readonly merger: EntityMergeService,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(AdminCacheService) private readonly cache: AdminCacheService,
  ) {}

  async setWorkersEnabled(
    tenantId: string,
    patch: Record<string, boolean>,
    actor: { userId: string },
  ): Promise<{ ok: true; workersEnabled: Record<string, boolean> }> {
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { workersEnabled: true },
    });
    if (!org) throw new Error(`Org not found: ${tenantId}`);
    const current = (org.workersEnabled ?? {}) as Record<string, unknown>;
    const merged: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(current)) {
      if (typeof v === 'boolean') merged[k] = v;
    }
    for (const [k, v] of Object.entries(patch)) {
      merged[k] = v;
    }
    await this.prisma.org.update({
      where: { id: tenantId },
      data: { workersEnabled: merged as unknown as Prisma.InputJsonValue },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'org_admin.set_workers_enabled',
        metadata: { patch } as unknown as Prisma.InputJsonValue,
      },
    });
    this.cache.invalidate(`usage:dashboard:org:${tenantId}:`);
    return { ok: true, workersEnabled: merged };
  }

  async getRecentAuditLogs(tenantId: string, args: { limit: number; entityTypes?: string[] }) {
    const where: Prisma.AuditLogWhereInput = { tenantId };
    if (args.entityTypes && args.entityTypes.length > 0) {
      where.OR = args.entityTypes.map((et) => ({
        action: { startsWith: `${et}.` },
      }));
    }
    const items = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args.limit,
    });
    return {
      items: items.map((a) => ({
        id: a.id,
        userId: a.userId,
        action: a.action,
        resourceId: a.resourceId,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  async listLinks(
    tenantId: string,
    args: {
      kind: 'block' | 'entity';
      sortBy: 'confidence' | 'createdAt';
      minConfidence?: number;
      status: 'active' | 'archived';
      limit: number;
    },
  ) {
    const orderBy =
      args.sortBy === 'confidence'
        ? { confidence: 'desc' as const }
        : { createdAt: 'desc' as const };

    if (args.kind === 'block') {
      const where: Prisma.IdeaBlockLinkWhereInput = {
        tenantId,
        status: args.status,
        deletedAt: null,
      };
      if (args.minConfidence !== undefined) {
        where.confidence = { gte: new Prisma.Decimal(args.minConfidence.toFixed(3)) };
      }
      const items = await this.prisma.ideaBlockLink.findMany({
        where,
        orderBy,
        take: args.limit,
      });
      return {
        kind: 'block' as const,
        items: items.map((l) => ({
          id: l.id,
          fromBlockId: l.fromBlockId,
          toBlockId: l.toBlockId,
          relationType: l.relationType,
          confidence: Number(l.confidence),
          explanation: l.explanation,
          createdBy: l.createdBy,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        })),
      };
    }
    const where: Prisma.EntityLinkWhereInput = {
      tenantId,
      status: args.status,
      deletedAt: null,
    };
    if (args.minConfidence !== undefined) {
      where.confidence = { gte: new Prisma.Decimal(args.minConfidence.toFixed(3)) };
    }
    const items = await this.prisma.entityLink.findMany({
      where,
      orderBy,
      take: args.limit,
    });
    return {
      kind: 'entity' as const,
      items: items.map((l) => ({
        id: l.id,
        fromEntityId: l.fromEntityId,
        toEntityId: l.toEntityId,
        relationType: l.relationType,
        confidence: Number(l.confidence),
        explanation: l.explanation,
        createdBy: l.createdBy,
        status: l.status,
        createdAt: l.createdAt.toISOString(),
      })),
    };
  }

  async deleteLink(
    tenantId: string,
    kind: 'block' | 'entity',
    linkId: string,
    actor: { userId: string },
  ): Promise<{ ok: true }> {
    if (kind === 'block') {
      const link = await this.prisma.ideaBlockLink.findFirst({
        where: { id: linkId, tenantId },
      });
      if (!link) throw new Error('Link not found');
      await this.prisma.ideaBlockLink.update({
        where: { id: linkId },
        data: { deletedAt: new Date(), deletedBy: actor.userId },
      });
    } else {
      const link = await this.prisma.entityLink.findFirst({
        where: { id: linkId, tenantId },
      });
      if (!link) throw new Error('Link not found');
      await this.prisma.entityLink.update({
        where: { id: linkId },
        data: { deletedAt: new Date(), deletedBy: actor.userId },
      });
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: `org_admin.${kind}_link.delete`,
        resourceId: linkId,
      },
    });
    return { ok: true };
  }

  async bulkDeleteLinks(
    tenantId: string,
    args: {
      kind: 'block' | 'entity';
      status?: 'active' | 'archived';
      maxConfidence?: number;
      beforeDate?: Date;
    },
    actor: { userId: string },
  ): Promise<{ ok: true; affected: number }> {
    const now = new Date();
    if (args.kind === 'block') {
      const where: Prisma.IdeaBlockLinkWhereInput = { tenantId, deletedAt: null };
      if (args.status) where.status = args.status;
      if (args.maxConfidence !== undefined) {
        where.confidence = { lte: new Prisma.Decimal(args.maxConfidence.toFixed(3)) };
      }
      if (args.beforeDate) where.createdAt = { lt: args.beforeDate };
      const result = await this.prisma.ideaBlockLink.updateMany({
        where,
        data: { deletedAt: now, deletedBy: actor.userId },
      });
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          userId: actor.userId,
          action: 'org_admin.block_link.bulk_delete',
          metadata: { affected: result.count, ...args } as unknown as Prisma.InputJsonValue,
        },
      });
      return { ok: true, affected: result.count };
    }
    const where: Prisma.EntityLinkWhereInput = { tenantId, deletedAt: null };
    if (args.status) where.status = args.status;
    if (args.maxConfidence !== undefined) {
      where.confidence = { lte: new Prisma.Decimal(args.maxConfidence.toFixed(3)) };
    }
    if (args.beforeDate) where.createdAt = { lt: args.beforeDate };
    const result = await this.prisma.entityLink.updateMany({
      where,
      data: { deletedAt: now, deletedBy: actor.userId },
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'org_admin.entity_link.bulk_delete',
        metadata: { affected: result.count, ...args } as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true, affected: result.count };
  }

  async mergeEntities(
    tenantId: string,
    fromEntityId: string,
    intoEntityId: string,
    actor: { userId: string },
  ): Promise<{ ok: true }> {
    const result = await this.merger.mergeManually({
      tenantId,
      fromEntityId,
      intoEntityId,
      byUserId: actor.userId,
    });
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'org_admin.entity.merge',
        resourceId: fromEntityId,
        metadata: { intoEntityId } as unknown as Prisma.InputJsonValue,
      },
    });
    return result;
  }

  async patchEntity(
    tenantId: string,
    entityId: string,
    args: { canonicalName?: string; addAlias?: string },
    actor: { userId: string },
  ): Promise<{ ok: true }> {
    const entity = await this.prisma.entity.findFirst({
      where: { id: entityId, tenantId },
    });
    if (!entity) throw new Error('Entity not found');
    const data: Prisma.EntityUpdateInput = {};
    if (args.canonicalName) {
      data.canonicalName = args.canonicalName.slice(0, 200);
    }
    if (args.addAlias) {
      const aliases = Array.from(new Set([...entity.aliases, args.addAlias.slice(0, 200)]));
      data.aliases = aliases;
    }
    if (Object.keys(data).length === 0) return { ok: true };
    await this.prisma.entity.update({ where: { id: entityId }, data });
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'org_admin.entity.patch',
        resourceId: entityId,
        metadata: args as unknown as Prisma.InputJsonValue,
      },
    });
    return { ok: true };
  }

  async reprocessRawEvent(
    tenantId: string,
    rawEventId: string,
    actor: { userId: string },
  ): Promise<{ ok: true; deletedBlocks: number }> {
    const event = await this.prisma.rawEvent.findFirst({
      where: { id: rawEventId, tenantId },
    });
    if (!event) throw new Error('RawEvent not found');

    const evidences = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId },
      select: { blockId: true },
    });
    const blockIds = Array.from(new Set(evidences.map((e) => e.blockId)));

    let deletedBlocks = 0;
    if (blockIds.length > 0) {
      const result = await this.prisma.ideaBlock.deleteMany({
        where: { id: { in: blockIds }, tenantId },
      });
      deletedBlocks = result.count;
    }

    await this.prisma.rawEvent.update({
      where: { id: rawEventId },
      data: {
        processingStatus: 'received',
        processingError: null,
        processedAt: null,
      },
    });

    await this.coreQueue.enqueueRawReceived(rawEventId, {
      suffix: Date.now().toString(),
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        action: 'org_admin.raw_event.reprocess',
        resourceId: rawEventId,
        metadata: { deletedBlocks } as unknown as Prisma.InputJsonValue,
      },
    });

    this.logger.log(
      { tenantId, rawEventId, deletedBlocks, by: actor.userId },
      'org-admin: reprocess RawEvent',
    );
    return { ok: true, deletedBlocks };
  }

  async getOrgMetrics(tenantId: string) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [
      rawEventsTotal,
      rawEventsRecent,
      blocksTotal,
      blocksCanonical,
      entitiesTotal,
      themesActive,
      blockLinksActive,
      entityLinksActive,
      ai24h,
      ai7d,
    ] = await Promise.all([
      this.prisma.rawEvent.count({ where: { tenantId } }),
      this.prisma.rawEvent.count({ where: { tenantId, receivedAt: { gte: sevenDaysAgo } } }),
      this.prisma.ideaBlock.count({ where: { tenantId } }),
      this.prisma.ideaBlock.count({ where: { tenantId, status: 'canonical' } }),
      this.prisma.entity.count({ where: { tenantId } }),
      this.prisma.theme.count({ where: { tenantId, status: 'active' } }),
      this.prisma.ideaBlockLink.count({
        where: { tenantId, status: 'active', deletedAt: null },
      }),
      this.prisma.entityLink.count({
        where: { tenantId, status: 'active', deletedAt: null },
      }),
      this.prisma.aiUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: oneDayAgo } },
        _sum: { inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
      this.prisma.aiUsageLog.aggregate({
        where: { tenantId, createdAt: { gte: sevenDaysAgo } },
        _sum: { inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      rawEvents: { total: rawEventsTotal, recent7d: rawEventsRecent },
      blocks: { total: blocksTotal, canonical: blocksCanonical },
      entities: { total: entitiesTotal },
      themes: { active: themesActive },
      links: {
        block: { active: blockLinksActive },
        entity: { active: entityLinksActive },
      },
      llm: {
        last24h: {
          calls: ai24h._count._all,
          inputTokens: ai24h._sum.inputTokens ?? 0,
          outputTokens: ai24h._sum.outputTokens ?? 0,
        },
        last7d: {
          calls: ai7d._count._all,
          inputTokens: ai7d._sum.inputTokens ?? 0,
          outputTokens: ai7d._sum.outputTokens ?? 0,
        },
      },
    };
  }
}
