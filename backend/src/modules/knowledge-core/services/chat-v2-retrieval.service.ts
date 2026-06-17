import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

export type ChatV2Scope = 'org' | 'meeting' | 'card' | 'theme' | 'entity';

export interface RetrievalInput {
  tenantId: string;
  scope: ChatV2Scope;
  scopeId: string | null;
  query: string;
  limit: number;
  graphHops: number;
  validAt?: Date | null;
  accessWhere?: Record<string, unknown>;
  contourGroupId?: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  signalTypes?: string[];
  entityIds?: string[];
  themeBranches?: string[];
  bitemporalActiveOnly?: boolean;
}

export interface RankedBlockId {
  blockId: string;
  score: number;
  fromGraph: boolean;
}

export interface StructuralFilterArgs {
  tenantParamRef: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
  signalTypes?: string[];
  entityIds?: string[];
  themeBranches?: string[];
  bitemporalActiveOnly?: boolean;
}

export function buildStructuralPredicates(
  args: StructuralFilterArgs,
  pushParam: (v: unknown) => string,
): string[] {
  const predicates: string[] = [];

  if (args.bitemporalActiveOnly) {
    predicates.push('b."validUntil" IS NULL');
  }

  if (args.signalTypes && args.signalTypes.length > 0) {
    const placeholders = args.signalTypes.map((s) => pushParam(s)).join(',');
    predicates.push(`b."signalType"::text IN (${placeholders})`);
  }

  if (args.entityIds && args.entityIds.length > 0) {
    const placeholders = args.entityIds.map((e) => pushParam(e)).join(',');
    predicates.push(
      `EXISTS (SELECT 1 FROM "IdeaBlockEntity" be WHERE be."blockId" = b.id AND be."entityId" IN (${placeholders}))`,
    );
  }

  if (args.dateFrom || args.dateTo) {
    const parts: string[] = [];
    if (args.dateFrom) {
      parts.push(`ev."sourceTimestamp" >= ${pushParam(args.dateFrom)}`);
    }
    if (args.dateTo) {
      parts.push(`ev."sourceTimestamp" <= ${pushParam(args.dateTo)}`);
    }
    predicates.push(
      `EXISTS (SELECT 1 FROM "IdeaBlockEvidence" ev WHERE ev."blockId" = b.id AND ${parts.join(' AND ')})`,
    );
  }

  if (args.themeBranches && args.themeBranches.length > 0) {
    const placeholders = args.themeBranches.map((t) => pushParam(t)).join(',');
    predicates.push(
      `EXISTS (SELECT 1 FROM "ThemeIdeaBlock" tib JOIN "Theme" t ON t.id = tib."themeId" ` +
        `WHERE tib."blockId" = b.id AND t."tenantId" = ${args.tenantParamRef} ` +
        `AND t."branch"::text IN (${placeholders}))`,
    );
  }

  return predicates;
}

export function hasStructuralFilter(input: RetrievalInput): boolean {
  return (
    !!input.dateFrom ||
    !!input.dateTo ||
    (input.signalTypes?.length ?? 0) > 0 ||
    (input.entityIds?.length ?? 0) > 0 ||
    (input.themeBranches?.length ?? 0) > 0 ||
    !!input.bitemporalActiveOnly
  );
}

interface RankedRow {
  id: string;
  score: string | number | null;
}

@Injectable()
export class ChatV2RetrievalService {
  private readonly logger = new Logger(ChatV2RetrievalService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  private temporalEdgeWhere(validAt: Date | null | undefined): {
    AND?: Array<{
      OR: Array<
        | { validFrom: null }
        | { validFrom: { lte: Date } }
        | { validUntil: null }
        | { validUntil: { gt: Date } }
      >;
    }>;
  } {
    if (!this.isBiTemporalEnabled()) return {};
    const at = validAt ?? new Date();
    return {
      AND: [
        {
          OR: [{ validFrom: null }, { validFrom: { lte: at } }],
        },
        {
          OR: [{ validUntil: null }, { validUntil: { gt: at } }],
        },
      ],
    };
  }

  private isBiTemporalEnabled(): boolean {
    try {
      return this.cfg.knowledgeCore.biTemporalEdgesEnabled === true;
    } catch {
      return false;
    }
  }

  async fetchCandidates(input: RetrievalInput): Promise<RankedBlockId[]> {
    let qvec: number[] | null = null;
    try {
      qvec = await this.embeddings.embedQuery(input.query);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'chat-v2 retrieval: embedQuery упал — будет ранжирование по BM25/recency',
      );
    }

    let poolBlockIds = await this.collectPool(input);
    if (poolBlockIds.length === 0) return [];

    if (input.validAt) {
      poolBlockIds = await this.filterByValidAt(input.tenantId, poolBlockIds, input.validAt);
      if (poolBlockIds.length === 0) return [];
    }

    const structural = hasStructuralFilter(input);
    let ranked: RankedBlockId[];
    if (structural) {
      ranked = await this.rankByStructuralFilter({
        tenantId: input.tenantId,
        blockIds: poolBlockIds,
        qvec,
        filters: {
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
          signalTypes: input.signalTypes,
          entityIds: input.entityIds,
          themeBranches: input.themeBranches,
          bitemporalActiveOnly: input.bitemporalActiveOnly,
        },
        limit: input.limit,
      });
    } else {
      ranked = await this.rankByCosineOrRecency({
        tenantId: input.tenantId,
        blockIds: poolBlockIds,
        qvec,
        query: input.query,
        limit: input.limit,
      });
    }
    if (ranked.length === 0) return [];

    const graphAdded =
      !structural && input.graphHops > 0
        ? await this.expandViaGraph({
            tenantId: input.tenantId,
            seedBlockIds: ranked.map((r) => r.blockId),
            knownIds: new Set(ranked.map((r) => r.blockId)),
            extraLimit: input.graphHops * 5,
            validAt: input.validAt ?? null,
            accessWhere: input.accessWhere,
            contourGroupId: input.contourGroupId,
          })
        : [];

    return [...ranked, ...graphAdded];
  }

  private async filterByValidAt(
    tenantId: string,
    blockIds: string[],
    validAt: Date,
  ): Promise<string[]> {
    if (blockIds.length === 0) return [];
    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId,
        status: 'canonical',
        createdAt: { lte: validAt },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async collectPool(input: RetrievalInput): Promise<string[]> {
    const { tenantId, scope, scopeId } = input;
    const accessWhere = input.accessWhere;
    const contourWhere: Record<string, unknown> = input.contourGroupId
      ? { blockAccess: { some: { groupId: input.contourGroupId } } }
      : {};
    if (scope === 'org') {
      const rows = await this.prisma.ideaBlock.findMany({
        where: {
          tenantId,
          status: 'canonical',
          ...(accessWhere ?? {}),
          ...contourWhere,
        },
        select: { id: true },
        take: 5000,
      });
      return rows.map((r) => r.id);
    }

    if (!scopeId) {
      this.logger.warn(
        { scope, scopeId },
        'chat-v2 retrieval: scopeId обязателен для не-org scope',
      );
      return [];
    }

    if (scope === 'meeting') {
      return this.poolByMeeting(tenantId, scopeId, accessWhere, contourWhere);
    }
    if (scope === 'card') {
      return this.poolByCard(tenantId, scopeId, accessWhere, contourWhere);
    }
    if (scope === 'theme') {
      return this.poolByTheme(tenantId, scopeId, accessWhere, contourWhere);
    }
    if (scope === 'entity') {
      return this.poolByEntity(tenantId, scopeId, accessWhere, contourWhere);
    }
    const _exhaustive: never = scope;
    throw new Error(`chat-v2 retrieval: unknown scope ${String(_exhaustive)}`);
  }

  private async poolByMeeting(
    tenantId: string,
    meetingId: string,
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
  ): Promise<string[]> {
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: {
        tenantId,
        sourceType: 'meeting',
        sourceExternalId: meetingId,
      },
      select: { id: true },
    });
    if (rawEvents.length === 0) return [];
    const evRows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        rawEventId: { in: rawEvents.map((r) => r.id) },
        block: {
          status: 'canonical',
          tenantId,
          ...(accessWhere ?? {}),
          ...(contourWhere ?? {}),
        },
      },
      select: { blockId: true },
      take: 1000,
    });
    return uniqueIds(evRows.map((e) => e.blockId));
  }

  private async poolByCard(
    tenantId: string,
    cardId: string,
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
  ): Promise<string[]> {
    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      select: {
        id: true,
        tenantId: true,
        deletedAt: true,
        entityId: true,
        relatedEntityIds: true,
      },
    });
    if (!card || card.deletedAt !== null || card.tenantId !== tenantId) {
      return [];
    }

    const meetingIds = (
      await this.prisma.meeting.findMany({
        where: { cardId, deletedAt: null, tenantId },
        select: { id: true },
      })
    ).map((m) => m.id);

    const blockIdSet = new Set<string>();

    if (meetingIds.length > 0) {
      const evRows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          rawEvent: {
            tenantId,
            sourceType: 'meeting',
            sourceExternalId: { in: meetingIds },
          },
          block: {
            status: 'canonical',
            tenantId,
            ...(accessWhere ?? {}),
            ...(contourWhere ?? {}),
          },
        },
        select: { blockId: true },
        take: 1000,
      });
      for (const r of evRows) blockIdSet.add(r.blockId);
    }

    const candidateEntityIds = [
      ...(card.entityId ? [card.entityId] : []),
      ...card.relatedEntityIds,
    ];
    if (candidateEntityIds.length > 0) {
      const entRows = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: candidateEntityIds },
          block: {
            status: 'canonical',
            tenantId,
            ...(accessWhere ?? {}),
            ...(contourWhere ?? {}),
          },
        },
        select: { blockId: true },
        take: 1000,
      });
      for (const r of entRows) blockIdSet.add(r.blockId);
    }

    return [...blockIdSet];
  }

  private async poolByTheme(
    tenantId: string,
    themeId: string,
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
  ): Promise<string[]> {
    const rows = await this.prisma.themeIdeaBlock.findMany({
      where: {
        themeId,
        theme: { tenantId, status: 'active' },
        block: {
          status: 'canonical',
          tenantId,
          ...(accessWhere ?? {}),
          ...(contourWhere ?? {}),
        },
      },
      select: { blockId: true },
      take: 1000,
    });
    return uniqueIds(rows.map((r) => r.blockId));
  }

  private async poolByEntity(
    tenantId: string,
    entityId: string,
    accessWhere?: Record<string, unknown>,
    contourWhere?: Record<string, unknown>,
  ): Promise<string[]> {
    const ent = await this.prisma.entity.findUnique({
      where: { id: entityId },
      select: { id: true, tenantId: true },
    });
    if (!ent || ent.tenantId !== tenantId) return [];

    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId,
        block: {
          status: 'canonical',
          tenantId,
          ...(accessWhere ?? {}),
          ...(contourWhere ?? {}),
        },
      },
      select: { blockId: true },
      take: 1000,
    });
    return uniqueIds(rows.map((r) => r.blockId));
  }

  private async rankByCosineOrRecency(args: {
    tenantId: string;
    blockIds: string[];
    qvec: number[] | null;
    query: string;
    limit: number;
  }): Promise<RankedBlockId[]> {
    const { tenantId, blockIds, qvec, limit } = args;
    if (blockIds.length === 0) return [];

    if (qvec) {
      const params: unknown[] = [];
      const pushParam = (v: unknown): string => {
        params.push(v);
        return `$${params.length}`;
      };
      const pTenant = pushParam(tenantId);
      const pIds = pushParam(blockIds);
      const pVec = pushParam(toVectorLiteral(qvec));
      const pLimit = pushParam(limit);
      const sql = `
        SELECT b.id,
               (1 - (b.embedding <=> ${pVec}::vector(1536))) AS score
        FROM "IdeaBlock" b
        WHERE b."tenantId" = ${pTenant}
          AND b.status = 'canonical'
          AND b.id = ANY(${pIds}::text[])
          AND b.embedding IS NOT NULL
        ORDER BY b.embedding <=> ${pVec}::vector(1536)
        LIMIT ${pLimit}
      `;
      const rows = await this.prisma.$queryRawUnsafe<RankedRow[]>(sql, ...params);
      return rows.map((r) => ({
        blockId: r.id,
        score: toFiniteNumber(r.score) ?? 0,
        fromGraph: false,
      }));
    }

    const rows = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        id: { in: blockIds },
      },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => ({
      blockId: r.id,
      score: 0,
      fromGraph: false,
    }));
  }

  private async rankByStructuralFilter(args: {
    tenantId: string;
    blockIds: string[];
    qvec: number[] | null;
    filters: Omit<StructuralFilterArgs, 'tenantParamRef'>;
    limit: number;
  }): Promise<RankedBlockId[]> {
    const { tenantId, blockIds, qvec, filters, limit } = args;
    if (blockIds.length === 0) return [];

    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    const pTenant = pushParam(tenantId);
    const pIds = pushParam(blockIds);

    if (qvec) {
      const pVec = pushParam(toVectorLiteral(qvec));
      const predicates = buildStructuralPredicates(
        { ...filters, tenantParamRef: pTenant },
        pushParam,
      );
      const pLimit = pushParam(limit);
      const whereExtra =
        predicates.length > 0 ? `\n          AND ${predicates.join('\n          AND ')}` : '';
      const sql = `
        SELECT b.id,
               (1 - (b.embedding <=> ${pVec}::vector(1536))) AS score
        FROM "IdeaBlock" b
        WHERE b."tenantId" = ${pTenant}
          AND b.status = 'canonical'
          AND b.id = ANY(${pIds}::text[])
          AND b.embedding IS NOT NULL${whereExtra}
        ORDER BY score DESC
        LIMIT ${pLimit}
      `;
      const rows = await this.prisma.$queryRawUnsafe<RankedRow[]>(sql, ...params);
      return rows.map((r) => ({
        blockId: r.id,
        score: toFiniteNumber(r.score) ?? 0,
        fromGraph: false,
      }));
    }

    const predicates = buildStructuralPredicates(
      { ...filters, tenantParamRef: pTenant },
      pushParam,
    );
    const pLimit = pushParam(limit);
    const whereExtra =
      predicates.length > 0 ? `\n          AND ${predicates.join('\n          AND ')}` : '';
    const sql = `
      SELECT b.id
      FROM "IdeaBlock" b
      WHERE b."tenantId" = ${pTenant}
        AND b.status = 'canonical'
        AND b.id = ANY(${pIds}::text[])${whereExtra}
      ORDER BY b."updatedAt" DESC
      LIMIT ${pLimit}
    `;
    const rows = await this.prisma.$queryRawUnsafe<RankedRow[]>(sql, ...params);
    return rows.map((r) => ({
      blockId: r.id,
      score: toFiniteNumber(r.score) ?? 0,
      fromGraph: false,
    }));
  }

  private async expandViaGraph(args: {
    tenantId: string;
    seedBlockIds: string[];
    knownIds: Set<string>;
    extraLimit: number;
    validAt: Date | null;
    accessWhere?: Record<string, unknown>;
    contourGroupId?: string;
  }): Promise<RankedBlockId[]> {
    const { tenantId, seedBlockIds, knownIds, extraLimit, validAt } = args;
    if (seedBlockIds.length === 0 || extraLimit <= 0) return [];

    const temporalWhere = this.temporalEdgeWhere(validAt);

    const linksFrom = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        fromBlockId: { in: seedBlockIds },
        ...temporalWhere,
      },
      select: { toBlockId: true, confidence: true },
      orderBy: { confidence: 'desc' },
      take: extraLimit * 3,
    });
    const linksTo = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId,
        status: 'active',
        toBlockId: { in: seedBlockIds },
        ...temporalWhere,
      },
      select: { fromBlockId: true, confidence: true },
      orderBy: { confidence: 'desc' },
      take: extraLimit * 3,
    });

    if (this.isBiTemporalEnabled() && this.metrics) {
      const passed = linksFrom.length + linksTo.length;
      for (let i = 0; i < passed; i++) {
        this.metrics.incTemporalFilterHit({ result: 'passed' });
      }
    }

    const candidates = new Map<string, number>();
    for (const l of linksFrom) {
      if (!knownIds.has(l.toBlockId)) {
        const conf = toFiniteNumber(l.confidence) ?? 0;
        const prev = candidates.get(l.toBlockId);
        if (prev === undefined || conf > prev) {
          candidates.set(l.toBlockId, conf);
        }
      }
    }
    for (const l of linksTo) {
      if (!knownIds.has(l.fromBlockId)) {
        const conf = toFiniteNumber(l.confidence) ?? 0;
        const prev = candidates.get(l.fromBlockId);
        if (prev === undefined || conf > prev) {
          candidates.set(l.fromBlockId, conf);
        }
      }
    }
    if (candidates.size === 0) return [];

    const sorted = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, extraLimit);

    const blockIds = sorted.map(([id]) => id);
    const canonical = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId,
        status: 'canonical',
        ...(validAt ? { createdAt: { lte: validAt } } : {}),
        ...(args.accessWhere ?? {}),
        ...(args.contourGroupId ? { blockAccess: { some: { groupId: args.contourGroupId } } } : {}),
      },
      select: { id: true },
    });
    const valid = new Set(canonical.map((b) => b.id));

    return sorted
      .filter(([id]) => valid.has(id))
      .map(([id, conf]) => ({
        blockId: id,
        score: -1 + conf * 0.001,
        fromGraph: true,
      }));
  }
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function toFiniteNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
