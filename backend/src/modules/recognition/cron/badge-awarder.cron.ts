import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { BadgeConditionsService } from '../services/badge-conditions.service';

@Injectable()
export class BadgeAwarderCron {
  private readonly logger = new Logger(BadgeAwarderCron.name);
  private static readonly CHUNK_SIZE = 500;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BadgeConditionsService)
    private readonly conditions: BadgeConditionsService,
  ) {}

  @Cron('0 5 * * *')
  async run(): Promise<void> {
    try {
      const startedAt = Date.now();
      const badges = await this.prisma.badge.findMany();
      if (badges.length === 0) {
        this.logger.warn(
          'badge-awarder: каталог Badge пуст — нечего проверять (нужно прогнать seed-badges)',
        );
        return;
      }
      const snapshots = await this.prisma.contributionSnapshot.findMany({
        select: {
          userId: true,
          ideasInDevelopment: true,
          ideasShipped: true,
          thanksReceived: true,
          thanksReceivedWeek: true,
          helpfulComments: true,
          probeQuestionsAnswered: true,
          currentCheckinStreak: true,
          longestCheckinStreak: true,
        },
      });
      let awarded = 0;
      for (let i = 0; i < snapshots.length; i += BadgeAwarderCron.CHUNK_SIZE) {
        const chunk = snapshots.slice(i, i + BadgeAwarderCron.CHUNK_SIZE);
        for (const snap of chunk) {
          try {
            const newly = await this.evaluateForUser(snap, badges);
            awarded += newly;
          } catch (err) {
            this.logger.warn(
              {
                userId: snap.userId,
                err: err instanceof Error ? err.message : String(err),
              },
              'badge-awarder: ошибка по user — пропускаю',
            );
          }
        }
      }
      this.logger.debug(
        `badge-awarder: snapshots=${snapshots.length} awarded=${awarded} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'badge-awarder: глобальная ошибка прохода',
      );
    }
  }

  async evaluateForUser(
    snap: {
      userId: string;
      ideasInDevelopment: number;
      ideasShipped: number;
      thanksReceived: number;
      thanksReceivedWeek: number;
      helpfulComments: number;
      probeQuestionsAnswered: number;
      currentCheckinStreak: number;
      longestCheckinStreak: number;
    },
    badges: Array<{ id: string; condition: unknown }>,
  ): Promise<number> {
    const existing = await this.prisma.userBadge.findMany({
      where: { userId: snap.userId },
      select: { badgeId: true },
    });
    const owned = new Set(existing.map((u) => u.badgeId));
    let awardedCount = 0;
    for (const b of badges) {
      if (owned.has(b.id)) continue;
      if (!this.conditions.evaluate(b.condition, snap)) continue;
      try {
        await this.prisma.userBadge.create({
          data: { userId: snap.userId, badgeId: b.id },
        });
        awardedCount += 1;
        this.logger.debug(`badge awarded: userId=${snap.userId} badgeId=${b.id}`);
      } catch (err) {
        this.logger.debug(
          {
            userId: snap.userId,
            badgeId: b.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'badge-awarder: пропуск (вероятно, race с unique)',
        );
      }
    }
    return awardedCount;
  }
}
