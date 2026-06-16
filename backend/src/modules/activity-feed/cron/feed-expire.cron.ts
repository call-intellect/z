import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { ActivityFeedService } from '../services/activity-feed.service';

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
        this.logger.debug({ updated }, 'FeedExpireCron — записи ленты помечены expired');
      }
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        'FeedExpireCron — sweep упал',
      );
    }
  }
}
