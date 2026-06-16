import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';

import {
  DEFAULT_KNOWS_WHO_MIN_CONFIDENCE,
  DEFAULT_KNOWS_WHO_TOP_K,
  rankExperts,
  type KnowsWhoConfidence,
  type KnowsWhoRow,
} from './knows-who.scoring';

@Injectable()
export class KnowsWhoService {
  private readonly logger = new Logger(KnowsWhoService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  async findExpertsForBlocker(args: {
    tenantId: string;
    blockerText?: string;
    blockId?: string;
    excludePersonId?: string | null;
    topK?: number;
  }): Promise<KnowsWhoExpert[]> {
    try {
      const enabled = await this.cfg.getDynamic<boolean>(
        'operations.knows_who.enabled',
        'OPERATIONS_KNOWS_WHO_ENABLED',
        true,
      );
      if (!enabled) {
        this.logger.debug('knows-who: operations.knows_who.enabled=false, skip');
        return [];
      }

      let queryText = (args.blockerText ?? '').trim();
      let excludePersonId = args.excludePersonId ?? null;

      if (args.blockId) {
        const block = await this.prisma.ideaBlock.findFirst({
          where: { tenantId: args.tenantId, id: args.blockId },
          select: {
            name: true,
            criticalQuestion: true,
            commitmentAuthorPersonId: true,
          },
        });
        if (block) {
          if (queryText.length === 0) {
            queryText = (block.name || block.criticalQuestion || '').trim();
          }
          if (!excludePersonId && block.commitmentAuthorPersonId) {
            excludePersonId = block.commitmentAuthorPersonId;
          }
        }
      }

      if (queryText.length === 0) {
        this.metrics.incKnowsWhoMatch({ found: 'no' });
        return [];
      }

      const minConfidence = await this.resolveMinConfidence();
      const topK = args.topK ?? DEFAULT_KNOWS_WHO_TOP_K;

      let queryVec: number[] | null;
      try {
        queryVec = await this.embeddings.embedQuery(queryText);
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'knows-who: embedQuery упал — возвращаю []',
        );
        this.metrics.incKnowsWhoMatch({ found: 'no' });
        return [];
      }
      if (!queryVec || queryVec.length === 0) {
        this.metrics.incKnowsWhoMatch({ found: 'no' });
        return [];
      }

      const vecLiteral = `[${queryVec.join(',')}]`;
      const sqlLimit = Math.max(topK * 3, 9);
      let rows: Array<{
        person_id: string;
        category_name: string;
        confidence: string;
        similarity: number;
      }> = [];
      try {
        rows = await this.prisma.$queryRaw<typeof rows>`
          SELECT pkce."personId" AS person_id,
                 pkce."categoryName" AS category_name,
                 pkce.confidence,
                 1 - (pkce.embedding <=> ${vecLiteral}::vector) AS similarity
          FROM person_knowledge_category_embeddings pkce
          JOIN persons p ON p.id = pkce."personId"
          WHERE pkce."tenantId" = ${args.tenantId}
            AND p.relationship = 'employee'
            AND p."deletedAt" IS NULL
            AND pkce.embedding IS NOT NULL
          ORDER BY pkce.embedding <=> ${vecLiteral}::vector
          LIMIT ${sqlLimit}
        `;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'knows-who: pgvector query упал — возвращаю []',
        );
        this.metrics.incKnowsWhoMatch({ found: 'no' });
        return [];
      }

      if (rows.length === 0) {
        this.metrics.incKnowsWhoMatch({ found: 'no' });
        return [];
      }

      const candidates = rankExperts({
        rows: rows.map(
          (r): KnowsWhoRow => ({
            personId: r.person_id,
            categoryName: r.category_name,
            confidence: r.confidence as KnowsWhoConfidence,
            similarity: r.similarity,
          }),
        ),
        excludePersonId,
        minConfidence,
        topK,
      });

      if (candidates.length === 0) {
        this.metrics.incKnowsWhoMatch({ found: 'no' });
        return [];
      }

      const persons = await this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          id: { in: candidates.map((c) => c.personId) },
        },
        select: { id: true, name: true },
      });
      const nameById = new Map(persons.map((p) => [p.id, p.name]));

      const out: KnowsWhoExpert[] = [];
      for (const c of candidates) {
        const name = nameById.get(c.personId);
        if (!name) continue;
        out.push({
          personId: c.personId,
          name,
          confidence: c.bestSimilarity,
          topCategories: c.topCategories.map((tc) => tc.name),
        });
      }

      this.metrics.incKnowsWhoMatch({ found: out.length > 0 ? 'yes' : 'no' });
      return out;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'knows-who.findExpertsForBlocker упал — возвращаю []',
      );
      this.metrics.incKnowsWhoMatch({ found: 'no' });
      return [];
    }
  }

  private async resolveMinConfidence(): Promise<number> {
    const v = await this.cfg.getDynamic<number>(
      'knows_who.min_confidence',
      'KNOWS_WHO_MIN_CONFIDENCE',
      DEFAULT_KNOWS_WHO_MIN_CONFIDENCE,
    );
    return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_KNOWS_WHO_MIN_CONFIDENCE;
  }
}

export interface KnowsWhoExpert {
  personId: string;
  name: string;
  confidence: number;
  topCategories: string[];
}

export type { KnowsWhoRow };
export const _DEFAULT_MIN_CONFIDENCE = DEFAULT_KNOWS_WHO_MIN_CONFIDENCE;
