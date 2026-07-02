import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface SimilarIntakeIssue {
  intakeIssueId: string;
  extractedTitle: string;
  distance: number;
}

@Injectable()
export class IntakeIssueSimilarService {
  static readonly DEFAULT_THRESHOLD = 0.15;
  static readonly DEFAULT_LIMIT = 5;
  static readonly MAX_LIMIT = 20;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async findSimilarByVector(args: {
    tenantId: string;
    embedding: string;
    limit?: number;
    threshold?: number;
    excludeIntakeIssueId?: string;
  }): Promise<SimilarIntakeIssue[]> {
    const limit = Math.min(
      Math.max(1, args.limit ?? IntakeIssueSimilarService.DEFAULT_LIMIT),
      IntakeIssueSimilarService.MAX_LIMIT,
    );
    const threshold =
      args.threshold ?? IntakeIssueSimilarService.DEFAULT_THRESHOLD;

    const params: unknown[] = [args.embedding, args.tenantId];
    const conditions: string[] = [
      '"tenantId" = $2',
      "status = 'pending'",
      'embedding IS NOT NULL',
    ];
    if (args.excludeIntakeIssueId) {
      params.push(args.excludeIntakeIssueId);
      conditions.push(`id <> $${params.length}`);
    }
    params.push(limit * 2);
    const limitParamIdx = params.length;

    const candidates = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        extractedTitle: string | null;
        distance: number;
      }>
    >(
      `SELECT
         id,
         "extractedTitle",
         (embedding <=> $1::vector) AS distance
       FROM "IntakeIssue"
       WHERE ${conditions.join('\n         AND ')}
       ORDER BY embedding <=> $1::vector
       LIMIT $${limitParamIdx}`,
      ...params,
    );

    const result: SimilarIntakeIssue[] = [];
    for (const row of candidates) {
      if (row.distance > threshold) continue;
      result.push({
        intakeIssueId: row.id,
        extractedTitle: row.extractedTitle ?? '',
        distance: row.distance,
      });
      if (result.length >= limit) break;
    }
    return result;
  }
}
