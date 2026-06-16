import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityFeedService } from '../services/activity-feed.service';

/**
 * FeedDigestCron (Wave 2 Поток D, 2026-05-24).
 *
 * Sub-ТЗ: plans/tz/2026-05-23-activity-feeds.md §"Cron-задачи".
 *
 * Запускается каждый день в 09:00 МСК. Собирает подписки с
 * `digestMode='daily_digest'` или `digestMode='weekly_digest'` (по
 * понедельникам), агрегирует записи за период и отправляет дайджест
 * через каналы подписки (`channels: in_app | telegram | email | mobile_push`).
 *
 * NOTE (Wave 2 limitation): фактическая доставка через каналы пока
 * НЕ реализована. Sub-ТЗ упоминает ConversationalService для каналов
 * telegram/email — интеграция требует отдельной итерации (потенциально —
 * новый воркер `feed-digest-deliver.worker` поверх BullMQ; ConversationalService
 * на текущем этапе ориентирован на point-to-point notifications, не на
 * массовые дайджесты).
 *
 * Этот cron на текущей итерации:
 *   1. Находит подходящие подписки.
 *   2. Агрегирует записи (count by feedType) для каждого подписчика.
 *   3. Логирует payload (TODO).
 *
 * TODO (отдельный sub-tz): добавить интеграцию с ConversationalService /
 * channel adapters для фактической отправки.
 */
@Injectable()
export class FeedDigestCron {
  private readonly logger = new Logger(FeedDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityFeedService)
    private readonly feed: ActivityFeedService,
  ) {}

  @Cron('0 9 * * *')
  async sendDailyDigests(): Promise<void> {
    await this.runDigest('daily');
  }

  /**
   * Weekly digests — те же 9:00, но только по понедельникам. NestJS @Cron
   * выражение `0 9 * * 1` (понедельник 9:00) — отдельный job, чтобы daily
   * шёл каждый день, а weekly — только в понедельник.
   */
  @Cron('0 9 * * 1')
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
              // визуально доступная — public_org или адресная для пользователя
              OR: [{ visibility: 'public_org' }, { targetUserId: sub.userId }],
            },
          });
          if (count > 0) {
            // TODO (отдельный sub-tz): тут будет вызов
            // ConversationalService.sendNotification(userId, channel, body)
            // с агрегированным payload'ом по типу ленты.
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
