import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../services/activity-feed.service';

@Injectable()
export class FeedDigestCron {
  private readonly logger = new Logger(FeedDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityFeedService)
    private readonly feed: ActivityFeedService,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Europe/Moscow' })
  async sendDailyDigests(): Promise<void> {
    await this.runDigest('daily');
  }

  @Cron('0 9 * * 1', { timeZone: 'Europe/Moscow' })
  async sendWeeklyDigests(): Promise<void> {
    await this.runDigest('weekly');
  }

  private async runDigest(kind: 'daily' | 'weekly'): Promise<void> {
    const mode = kind === 'daily' ? 'daily_digest' : 'weekly_digest';
    try {
      const subscriptions = await this.prisma.activityFeedSubscription.findMany({
        where: { digestMode: mode },
      });
      if (subscriptions.length === 0) {
        this.logger.debug({ kind }, 'FeedDigestCron — нет подписок на дайджест');
        return;
      }

      const since = new Date();
      since.setDate(since.getDate() - (kind === 'daily' ? 1 : 7));

      let processed = 0;
      for (const sub of subscriptions) {
        try {
          const count = await this.prisma.activityFeedItem.count({
            where: {
              feedType: sub.feedType,
              emittedAt: { gte: since },
              OR: [{ visibility: 'public_org' }, { targetUserId: sub.userId }],
            },
          });
          if (count > 0) {
            this.logger.debug(
              {
                userId: sub.userId,
                feedType: sub.feedType,
                channels: sub.channels,
                kind,
                count,
              },
              'FeedDigestCron — собран дайджест (доставка TODO)',
            );
          }
          processed += 1;
        } catch (e) {
          this.logger.warn(
            {
              userId: sub.userId,
              feedType: sub.feedType,
              err: e instanceof Error ? e.message : String(e),
            },
            'FeedDigestCron — ошибка дайджеста одной подписки',
          );
        }
      }
      this.logger.debug(
        { kind, totalSubscriptions: subscriptions.length, processed },
        'FeedDigestCron — завершено',
      );
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e), kind },
        'FeedDigestCron — фатальная ошибка',
      );
    }
  }
}
