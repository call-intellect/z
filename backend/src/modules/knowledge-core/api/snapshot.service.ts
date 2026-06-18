import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';

import type { BlockSearchItemDto, EntityItemDto, EvidenceItemDto } from './dto/search.dto';
import type {
  SnapshotBlockItemDto,
  SnapshotEntityLinkDto,
  SnapshotResponseDto,
  SnapshotServiceArgs,
} from './dto/snapshot.dto';

@Injectable()
export class SnapshotService {
  private readonly logger = new Logger(SnapshotService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async getSnapshot(args: SnapshotServiceArgs): Promise<SnapshotResponseDto> {
    const startedAt = Date.now();
    const fetchLimit = args.limit + 1;

    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off'
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId: args.tenantId,
            userId: args.userId,
          })
        : null;

    const blockWhere = this.buildBlockWhere(args, enf, accessCtx);
    const linkWhere = this.buildLinkWhere(args);

    const [blockRows, linkRows] = await Promise.all([
      this.prisma.ideaBlock.findMany({
        where: blockWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: fetchLimit,
      }),
      this.prisma.entityLink.findMany({
        where: linkWhere,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: fetchLimit,
      }),
    ]);

    const blocksTruncated = blockRows.length > args.limit;
    const linksTruncated = linkRows.length > args.limit;
    const trimmedBlocks = blocksTruncated ? blockRows.slice(0, args.limit) : blockRows;
    const trimmedLinks = linksTruncated ? linkRows.slice(0, args.limit) : linkRows;

    const blockIds = trimmedBlocks.map((b) => b.id);

    if (enf === 'shadow' && accessCtx && !accessCtx.isBypass) {
      const { denied } = await this.accessResolver.partitionBlockIdsByAccess(accessCtx, blockIds);
      this.metrics.incAccessShadowDiff({ surface: 'snapshot' }, denied);
    }

    const [evidenceMap, entitiesMap] = await Promise.all([
      this.loadEvidence(blockIds),
      this.loadEntities(blockIds),
    ]);

    const blocks: SnapshotBlockItemDto[] = trimmedBlocks.map((b) => ({
      block: this.mapBlock(b),
      evidence: evidenceMap.get(b.id) ?? [],
      entities: entitiesMap.get(b.id) ?? [],
    }));

    const entityLinks: SnapshotEntityLinkDto[] = trimmedLinks.map((l) => ({
      id: l.id,
      fromEntityId: l.fromEntityId,
      toEntityId: l.toEntityId,
      fromType: l.fromType,
      toType: l.toType,
      relationType: l.relationType,
      validFrom: l.validFrom.toISOString(),
      validUntil: l.validUntil ? l.validUntil.toISOString() : null,
    }));

    return {
      asOf: args.at.toISOString(),
      blocks,
      entityLinks,
      truncated: blocksTruncated || linksTruncated,
      tookMs: Date.now() - startedAt,
    };
  }

  private buildBlockWhere(
    args: SnapshotServiceArgs,
    enforcement: 'off' | 'shadow' | 'enforce' = 'off',
    accessCtx: KnowledgeAccessContext | null = null,
  ): Prisma.IdeaBlockWhereInput {
    const and: Prisma.IdeaBlockWhereInput[] = [
      { OR: [{ validFrom: null }, { validFrom: { lte: args.at } }] },
      { OR: [{ validUntil: null }, { validUntil: { gt: args.at } }] },
    ];
    if (enforcement === 'enforce' && accessCtx && !accessCtx.isBypass) {
      and.push(this.accessResolver.buildAccessWhere(accessCtx));
    }
    const where: Prisma.IdeaBlockWhereInput = {
      tenantId: args.tenantId,
      status: 'canonical',
      AND: and,
    };
    if (args.signalTypes && args.signalTypes.length > 0) {
      where.signalType = {
        in: args.signalTypes as Prisma.IdeaBlockWhereInput['signalType'] extends
          | { in?: infer U }
          | undefined
          ? U
          : never,
      } as Prisma.IdeaBlockWhereInput['signalType'];
    }
    if (args.entityId) {
      where.entities = { some: { entityId: args.entityId } };
    }
    return where;
  }

  private buildLinkWhere(args: SnapshotServiceArgs): Prisma.EntityLinkWhereInput {
    const where: Prisma.EntityLinkWhereInput = {
      tenantId: args.tenantId,
      status: 'active',
      deletedAt: null,
      AND: [
        { validFrom: { lte: args.at } },
        { OR: [{ validUntil: null }, { validUntil: { gt: args.at } }] },
      ],
    };
    if (args.entityId) {
      where.OR = [{ fromEntityId: args.entityId }, { toEntityId: args.entityId }];
    }
    return where;
  }

  private async loadEvidence(blockIds: string[]): Promise<Map<string, EvidenceItemDto[]>> {
    if (blockIds.length === 0) return new Map();
    const rows = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      orderBy: { createdAt: 'asc' },
    });
    const map = new Map<string, EvidenceItemDto[]>();
    for (const r of rows) {
      const list = map.get(r.blockId) ?? [];
      if (list.length < 3) {
        list.push({
          id: r.id,
          rawEventId: r.rawEventId,
          sourceType: r.sourceType,
          sourceTimestamp: r.sourceTimestamp ? r.sourceTimestamp.toISOString() : null,
          quote: r.quote,
          startMs: r.startMs,
          endMs: r.endMs,
        });
        map.set(r.blockId, list);
      }
    }
    return map;
  }

  private async loadEntities(blockIds: string[]): Promise<Map<string, EntityItemDto[]>> {
    if (blockIds.length === 0) return new Map();
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: { blockId: { in: blockIds } },
      include: { entity: true },
      orderBy: { createdAt: 'asc' },
    });
    const map = new Map<string, EntityItemDto[]>();
    for (const r of rows) {
      const list = map.get(r.blockId) ?? [];
      list.push({
        id: r.entity.id,
        type: r.entity.type,
        canonicalName: r.entity.canonicalName,
        aliases: r.entity.aliases,
        mentionsCount: r.entity.mentionsCount,
        metadata: this.jsonToPlainObject(r.entity.metadata),
      });
      map.set(r.blockId, list);
    }
    return map;
  }

  private mapBlock(b: {
    id: string;
    name: string;
    criticalQuestion: string;
    trustedAnswer: string;
    tags: string[];
    signalType: string;
    confidence: unknown;
    evidenceCount: number;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }): BlockSearchItemDto {
    return {
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      confidence: this.toFiniteNumber(b.confidence) ?? 0,
      evidenceCount: b.evidenceCount,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  private toFiniteNumber(v: unknown): number | null {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (v instanceof Prisma.Decimal) {
      const n = Number(v.toString());
      return Number.isFinite(n) ? n : null;
    }
    if (v && typeof (v as { toString?: () => string }).toString === 'function') {
      const n = Number((v as { toString: () => string }).toString());
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private jsonToPlainObject(v: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  }
}
