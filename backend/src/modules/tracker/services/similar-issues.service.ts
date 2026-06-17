import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';
import type { SimilarIssueDto } from '../dto/issues/similar-issue.dto';

@Injectable()
export class SimilarIssuesService {
  private readonly logger = new Logger(SimilarIssuesService.name);
  static readonly DEFAULT_THRESHOLD = 0.18;
  static readonly DEFAULT_LIMIT = 5;
  static readonly MAX_LIMIT = 20;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async findSimilar(args: {
    tenantId: string;
    issueId: string;
    limit?: number;
    threshold?: number;
  }): Promise<SimilarIssueDto[]> {
    const tenantTop = tenantTopOf(args.tenantId);
    this.metrics.incTrackerIssueSimilarSearch({ tenantTop });

    const limit = Math.min(
      Math.max(1, args.limit ?? SimilarIssuesService.DEFAULT_LIMIT),
      SimilarIssuesService.MAX_LIMIT,
    );
    const threshold = args.threshold ?? SimilarIssuesService.DEFAULT_THRESHOLD;

    const seedRows = await this.prisma.$queryRawUnsafe<Array<{ embedding: string | null }>>(
      'SELECT embedding::text AS embedding FROM "Issue" WHERE id = $1 AND "tenantId" = $2 AND "deletedAt" IS NULL',
      args.issueId,
      args.tenantId,
    );
    const seed = seedRows[0];
    if (!seed?.embedding) {
      this.logger.debug(
        { issueId: args.issueId },
        'similar-issues: у исходной задачи нет embedding — empty result',
      );
      return [];
    }

    const candidates = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        identifier: string;
        title: string;
        stateId: string | null;
        projectId: string;
        completedAt: Date | null;
        distance: number;
      }>
    >(
      `SELECT
         id,
         identifier,
         title,
         "stateId",
         "completedAt",
         "projectId",
         (embedding <=> $1::vector) AS distance
       FROM "Issue"
       WHERE "tenantId" = $2
         AND id <> $3
         AND embedding IS NOT NULL
         AND "deletedAt" IS NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $4`,
      seed.embedding,
      args.tenantId,
      args.issueId,
      limit * 2,
    );

    const result: SimilarIssueDto[] = [];
    for (const row of candidates) {
      if (row.distance > threshold) continue;
      result.push({
        id: row.id,
        identifier: row.identifier,
        title: row.title,
        stateId: row.stateId,
        projectId: row.projectId,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        similarity: this.clamp01(1 - row.distance),
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  private clamp01(v: number): number {
    if (Number.isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }
}
