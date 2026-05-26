import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Specialist38HelpfulnessService } from '../services/specialist-3-8-helpfulness.service';

/**
 * SBA Wave 2 — HelpfulnessTraitDecayCron.
 *
 * Каждый день в 06:00 UTC помечает trait'ы, у которых не было новых
 * наблюдений > 30 дней (`lastObservedAt < now-30d` AND `status='active'`):
 *
 *   - status = 'decayed'
 *   - decayedAt = now
 *
 * Decayed trait'ы НЕ удаляются (история сохраняется), но исключаются из:
 *   - SocialContributionProfileCron (агрегация по status='active')
 *   - HelpfulnessSpotlightCron (агрегация по status='active')
 *   - публичных API эндпоинтов
 *
 * Идемпотентно: повторный прогон ничего не делает (decayed уже выставлены).
 *
 * NB: порог 30 дней — берём sub-ТЗ §«Жизненный цикл» вариант (vs 90 дней в
 * sub-ТЗ §«Cron»). 30 даёт более актуальный профиль для weekly spotlight.
 * При необходимости — вынести в env позже.
 */
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
      this.logger.log(summary, 'helpfulness-trait-decay.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'helpfulness-trait-decay.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для ручного запуска / тестов. */
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
