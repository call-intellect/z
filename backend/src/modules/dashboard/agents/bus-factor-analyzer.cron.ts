import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class BusFactorAnalyzerCron {
  private readonly logger = new Logger(BusFactorAnalyzerCron.name);
  private static readonly MAX_ORGS_PER_RUN = 5_000;
  private static readonly TOP_EXPERTS_LIMIT = 5;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'bus-factor-analyzer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `bus-factor-analyzer.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    snapshotsCreated: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: BusFactorAnalyzerCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let snapshotsCreated = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        snapshotsCreated += await this.processOrg(org.id);
      } catch (err) {
        errors++;
        this.logger.warn(
          `bus-factor-analyzer org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, snapshotsCreated, errors };
  }

  private async processOrg(tenantId: string): Promise<number> {
    const rows = await this.prisma.personKnowledgeCategoryEmbedding.findMany({
      where: { tenantId },
      select: {
        categoryName: true,
        confidence: true,
        personId: true,
        person: { select: { name: true, deletedAt: true } },
      },
    });

    if (rows.length === 0) return 0;

    const byCategory = new Map<
      string,
      Array<{ personId: string; name: string; confidence: string }>
    >();
    for (const r of rows) {
      if (!r.person || r.person.deletedAt) continue;
      const list = byCategory.get(r.categoryName) ?? [];
      list.push({
        personId: r.personId,
        name: r.person.name,
        confidence: r.confidence,
      });
      byCategory.set(r.categoryName, list);
    }

    if (byCategory.size === 0) return 0;

    let created = 0;
    for (const [categoryName, experts] of byCategory) {
      const high = experts.filter((e) => e.confidence === 'high');
      const medium = experts.filter((e) => e.confidence === 'medium');
      const highConfidenceCount = high.length;
      const totalExpertsCount = high.length + medium.length;
      const riskLevel = computeRiskLevel(highConfidenceCount);

      const topExperts = [...high, ...medium].slice(0, BusFactorAnalyzerCron.TOP_EXPERTS_LIMIT);

      await this.prisma.knowledgeRiskSnapshot.create({
        data: {
          tenantId,
          categoryName,
          highConfidenceCount,
          totalExpertsCount,
          riskLevel,
          topExpertsJson: { experts: topExperts } as unknown as Prisma.InputJsonValue,
        },
      });
      created++;
    }

    return created;
  }
}

export function computeRiskLevel(highConfidenceCount: number): 'critical' | 'warning' | 'ok' {
  if (highConfidenceCount <= 1) return 'critical';
  if (highConfidenceCount <= 3) return 'warning';
  return 'ok';
}
