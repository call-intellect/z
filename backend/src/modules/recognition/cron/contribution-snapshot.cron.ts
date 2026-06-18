import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class ContributionSnapshotCron {
  private readonly logger = new Logger(ContributionSnapshotCron.name);

  private static readonly CHUNK_SIZE = 500;
  private static readonly WEEK_MS = 7 * 24 * 3600 * 1000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron('0 4 * * *')
  async run(): Promise<void> {
    try {
      const startedAt = Date.now();
      const users = await this.collectActiveUserIds();
      let processed = 0;
      for (let i = 0; i < users.length; i += ContributionSnapshotCron.CHUNK_SIZE) {
        const chunk = users.slice(i, i + ContributionSnapshotCron.CHUNK_SIZE);
        for (const userId of chunk) {
          try {
            await this.recomputeOne(userId);
            processed += 1;
          } catch (err) {
            this.logger.warn(
              {
                userId,
                err: err instanceof Error ? err.message : String(err),
              },
              'contribution-snapshot: ошибка по user — пропускаю',
            );
          }
        }
      }
      this.logger.debug(
        `contribution-snapshot: processed=${processed}/${users.length} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'contribution-snapshot: глобальная ошибка прохода',
      );
    }
  }

  private async collectActiveUserIds(): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      select: { userId: true },
      distinct: ['userId'],
      orderBy: { userId: 'asc' },
    });
    return rows.map((r) => r.userId);
  }

  async recomputeOne(userId: string): Promise<void> {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - ContributionSnapshotCron.WEEK_MS);

    const [ideasInDevelopment, ideasShipped] = await Promise.all([
      this.prisma.idea.count({
        where: { createdByUserId: userId, status: 'in_progress' },
      }),
      this.prisma.idea.count({
        where: { createdByUserId: userId, status: 'shipped' },
      }),
    ]);

    const thanksTypes = ['thanks_comment', 'thanks_helpfulness', 'mention_helped'];
    const [thanksReceived, thanksReceivedWeek] = await Promise.all([
      this.prisma.recognition.count({
        where: { toUserId: userId, type: { in: thanksTypes } },
      }),
      this.prisma.recognition.count({
        where: {
          toUserId: userId,
          type: { in: thanksTypes },
          createdAt: { gte: weekAgo },
        },
      }),
    ]);

    const recentComments = await this.prisma.issueComment.findMany({
      where: { authorId: userId, deletedAt: null },
      select: { thanksUserIds: true },
      take: 1000,
    });
    const helpfulComments = recentComments.reduce(
      (acc, c) => acc + (c.thanksUserIds?.length ?? 0),
      0,
    );

    const probeQuestionsAnswered = await this.prisma.notification.count({
      where: {
        recipientUserId: userId,
        eventType: 'probe.question',
        responseStatus: 'answered',
      },
    });

    const existing = await this.prisma.contributionSnapshot.findUnique({
      where: { userId },
      select: {
        currentCheckinStreak: true,
        longestCheckinStreak: true,
      },
    });
    const currentCheckinStreak = existing?.currentCheckinStreak ?? 0;
    const longestCheckinStreak = existing?.longestCheckinStreak ?? 0;

    await this.prisma.contributionSnapshot.upsert({
      where: { userId },
      create: {
        userId,
        ideasInDevelopment,
        ideasShipped,
        thanksReceived,
        thanksReceivedWeek,
        helpfulComments,
        probeQuestionsAnswered,
        currentCheckinStreak,
        longestCheckinStreak,
      },
      update: {
        ideasInDevelopment,
        ideasShipped,
        thanksReceived,
        thanksReceivedWeek,
        helpfulComments,
        probeQuestionsAnswered,
      },
    });
  }
}
