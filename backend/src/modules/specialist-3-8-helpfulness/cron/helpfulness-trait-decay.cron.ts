import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist38HelpfulnessService } from '../services/specialist-3-8-helpfulness.service';

@Injectable()
export class HelpfulnessTraitDecayCron {
  private readonly logger = new Logger(HelpfulnessTraitDecayCron.name);
  private static readonly DECAY_THRESHOLD_DAYS = 30;
  private static readonly BATCH_SIZE = 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 6 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.debug(summary, 'helpfulness-trait-decay.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'helpfulness-trait-decay.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{ decayedCount: number }> {
    const now = new Date();
    const threshold = new Date(
      now.getTime() - HelpfulnessTraitDecayCron.DECAY_THRESHOLD_DAYS * 86400 * 1000,
    );

    const result = await this.prisma.helpfulnessTrait.updateMany({
      where: {
        status: 'active',
        lastObservedAt: { lt: threshold },
      },
      data: {
        status: 'decayed',
        decayedAt: now,
      },
    });

    if (result.count > 0) {
      this.metrics.incCoreSpecialistCards({
        type: Specialist38HelpfulnessService.METRIC_TYPE,
        status: 'decayed',
      });
    }

    return { decayedCount: result.count };
  }
}
