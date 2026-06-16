import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ActivityFeedService } from '../services/activity-feed.service';

/**
 * FeedExpireCron (Wave 2 Поток D, 2026-05-24).
 *
 * Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md §"Cron-задачи".
 *
 * Каждые 15 минут помечает status='expired' для записей ленты, у которых
 * `expiresAt < now AND status NOT IN ('responded', 'actioned', 'expired',
 * 'dismissed')`. Главный потребитель — probe-вопросы Probe-Agent
 * (sub-ТЗ требует expire через 24-72 часа).
 *
 * Cron-выражение литералом в декораторе (NestJS @Cron не читает ENV).
 */
@Injectable()
export class FeedExpireCron {
  private readonly logger = new Logger(FeedExpireCron.name);

  constructor(
    @Inject(ActivityFeedService)
    private readonly feed: ActivityFeedService,
  ) {}

  @Cron('*/15 * * * *')
  async sweep(): Promise<void> {
    try {
      const { updated } = await this.feed.expire({ now: new Date() });
      if (updated > 0) {
        this.logger.debug(
          { updated },
          'FeedExpireCron — записи ленты помечены expired',
        );
      }
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        'FeedExpireCron — sweep упал',
      );
    }
  }
}
