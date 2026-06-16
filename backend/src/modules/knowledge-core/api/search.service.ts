import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  KnowledgeAccessResolver,
  type KnowledgeAccessContext,
} from '../../rbac/knowledge-access-resolver.service';
import { KnowledgeEmbeddingService } from '../services/embedding.service';

import type {
  BlockSearchItemDto,
  EntityItemDto,
  EvidenceItemDto,
  SearchRequestDto,
  SearchResultItemDto,
  SearchResultsDto,
} from './dto/search.dto';

interface RawSearchRow {
  id: string;
  tenantId: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  tags: string[];
  signalType: string;
  confidence: string | number;
  status: string;
  evidenceCount: number;
  createdAt: Date;
  updatedAt: Date;
  cosine_score: string | number | null;
  bm25_score: string | number | null;
  combined_score: string | number;
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async search(
    args: SearchRequestDto & { tenantId: string; userId?: string },
  ): Promise<SearchResultsDto> {
    const startedAt = Date.now();

    const enf = this.cfg.knowledgeAccess.enforcement;
    const accessCtx =
      enf !== 'off' && args.userId
        ? await this.accessResolver.resolveAccessibleGroups({
            tenantId: args.tenantId,
            userId: args.userId,
          })
        : null;

    let qvec: number[] | null = null;
    try {
      qvec = await this.embeddings.embedQuery(args.query);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'search: embedQuery упал — будем искать только BM25',
      );
    }

    const cosineWeight = this.cfg.knowledgeCore.searchCosineWeight;
    const bm25Weight = this.cfg.knowledgeCore.searchBm25Weight;
    const bitemporalActiveOnly = this.cfg.bitemporal.enabled;

    const rows = await this.runHybridQuery({
      tenantId: args.tenantId,
      query: args.query,
      qvec,
      cosineWeight,
      bm25Weight,
      signalTypes: args.signalTypes,
      entityIds: args.entityIds,
      dateFrom: args.dateFrom ?? null,
      dateTo: args.dateTo ?? null,
      limit: args.limit,
      bitemporalActiveOnly,
      accessCtx,
      enforcement: enf,
    });

    if (rows.length === 0) {
      return { results: [], tookMs: Date.now() - startedAt };
    }

    const blockIds = rows.map((r) => r.id);

    if (enf === 'shadow' && accessCtx && !accessCtx.isBypass) {
      const { denied } = await this.accessResolver.partitionBlockIdsByAccess(accessCtx, blockIds);
      this.metrics.incAccessShadowDiff({ surface: 'search' }, denied);
    }
    const [evidenceMap, entitiesMap] = await Promise.all([
      this.loadEvidence(blockIds),
      this.loadEntities(blockIds),
    ]);

    const results: SearchResultItemDto[] = rows.map((r) => ({
      block: this.rowToBlockDto(r),
      evidence: evidenceMap.get(r.id) ?? [],
      entities: entitiesMap.get(r.id) ?? [],
      scores: {
        cosine: this.toFiniteNumber(r.cosine_score) ?? 0,
        bm25: this.toFiniteNumber(r.bm25_score) ?? 0,
        combined: this.toFiniteNumber(r.combined_score) ?? 0,
      },
    }));

    return { results, tookMs: Date.now() - startedAt };
  }

  private async runHybridQuery(args: {
    tenantId: string;
    query: string;
    qvec: number[] | null;
    cosineWeight: number;
    bm25Weight: number;
    signalTypes?: string[];
    entityIds?: string[];
    dateFrom: Date | null;
    dateTo: Date | null;
    limit: number;
    bitemporalActiveOnly?: boolean;
    accessCtx: KnowledgeAccessContext | null;
    enforcement: 'off' | 'shadow' | 'enforce';
  }): Promise<RawSearchRow[]> {
    const params: unknown[] = [];
    const pushParam = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    const pTenant = pushParam(args.tenantId);
    const pQtext = pushParam(args.query);
    const pWcos = pushParam(args.cosineWeight);
    const pWbm = pushParam(args.bm25Weight);

    const cosineSelect = args.qvec
      ? `(1 - (b.embedding <=> ${pushParam(this.toVectorLiteral(args.qvec))}::vector(1536)))`
      : '0::float';

    const filters: string[] = [`b."tenantId" = ${pTenant}`, `b.status = 'canonical'`];
    if (args.bitemporalActiveOnly) {
      filters.push('b."validUntil" IS NULL');
    }
    if (args.qvec) {
      filters.push('b.embedding IS NOT NULL');
    }
    if (args.signalTypes && args.signalTypes.length > 0) {
      const placeholders = args.signalTypes.map((s) => `${pushParam(s)}`).join(',');
      filters.push(`b."signalType"::text IN (${placeholders})`);
    }
    if (args.entityIds && args.entityIds.length > 0) {
      const placeholders = args.entityIds.map((e) => `${pushParam(e)}`).join(',');
      filters.push(
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
      filters.push(
        `EXISTS (SELECT 1 FROM "IdeaBlockEvidence" ev WHERE ev."blockId" = b.id AND ${parts.join(' AND ')})`,
      );
    }

    if (args.enforcement === 'enforce' && args.accessCtx && !args.accessCtx.isBypass) {
      const pred = this.accessResolver.buildAccessSqlPredicate(args.accessCtx, pushParam);
      if (pred) filters.push(`(1=1 ${pred})`);
    }

    const pLimit = pushParam(args.limit);

    const sql = `
      WITH q AS (
        SELECT plainto_tsquery('russian', ${pQtext}) AS qtsq
      )
      SELECT b.id, b."tenantId", b.name, b."criticalQuestion", b."trustedAnswer",
             b.tags, b."signalType", b.confidence, b.status, b."evidenceCount",
             b."createdAt", b."updatedAt",
             ${cosineSelect} AS cosine_score,
             COALESCE(ts_rank(b.search_tsv, (SELECT qtsq FROM q)), 0) AS bm25_score,
             (
               ${pWcos}::float * ${cosineSelect}
               + ${pWbm}::float * COALESCE(ts_rank(b.search_tsv, (SELECT qtsq FROM q)), 0)
             ) AS combined_score
      FROM "IdeaBlock" b
      WHERE ${filters.join(' AND ')}
      ORDER BY combined_score DESC
      LIMIT ${pLimit}
    `;

    return this.prisma.$queryRawUnsafe<RawSearchRow[]>(sql, ...params);
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

  private rowToBlockDto(r: RawSearchRow): BlockSearchItemDto {
    return {
      id: r.id,
      name: r.name,
      criticalQuestion: r.criticalQuestion,
      trustedAnswer: r.trustedAnswer,
      signalType: r.signalType,
      tags: r.tags,
      confidence: this.toFiniteNumber(r.confidence) ?? 0,
      evidenceCount: r.evidenceCount,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
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
    return null;
  }

  private jsonToPlainObject(v: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
    return v as Record<string, unknown>;
  }
}
