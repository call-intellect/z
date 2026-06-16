import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecognitionService } from '../services/recognition.service';

@Injectable()
export class RecognitionWeeklyDigestCron {
  private readonly logger = new Logger(RecognitionWeeklyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecognitionService)
    private readonly recognition: RecognitionService,
  ) {}

  @Cron('0 9 * * 1')
  async run(): Promise<void> {
    try {
      const startedAt = Date.now();
      const week = this.isoWeek(new Date());

      const memberships = await this.prisma.membership.findMany({
        select: { userId: true, orgId: true },
        distinct: ['userId', 'orgId'],
      });

      let weeklyEnqueued = 0;
      let unrecognizedFlagged = 0;
      for (const m of memberships) {
        try {
          const snap = await this.prisma.contributionSnapshot.findUnique({
            where: { userId: m.userId },
          });
          if (!snap) continue;
          const hasMeaningfulActivity =
            snap.thanksReceivedWeek > 0 || snap.helpfulComments > 0 || snap.ideasInDevelopment > 0;
          if (hasMeaningfulActivity) {
            await this.recognition.enqueueFormulate({
              tenantId: m.orgId,
              type: 'weekly_summary',
              toUserId: m.userId,
              fromUserId: null,
              contextEntityType: null,
              contextEntityId: week,
              visibility: 'private',
              contextPayload: {
                thanksReceivedWeek: snap.thanksReceivedWeek,
                helpfulComments: snap.helpfulComments,
                ideasInDevelopment: snap.ideasInDevelopment,
                probeQuestionsAnswered: snap.probeQuestionsAnswered,
              },
            });
            weeklyEnqueued += 1;
          }
          if (snap.helpfulComments >= 10 && snap.thanksReceived === 0) {
            unrecognizedFlagged += 1;
            await this.recognition.enqueueFormulate({
              tenantId: m.orgId,
              type: 'thanks_helpfulness',
              toUserId: m.userId,
              fromUserId: null,
              contextEntityType: null,
              contextEntityId: `unrecognized_${week}`,
              visibility: 'private',
              contextPayload: {
                helpfulComments: snap.helpfulComments,
                note: 'unrecognized_high_contributor',
              },
            });
          }
        } catch (err) {
          this.logger.warn(
            {
              userId: m.userId,
              orgId: m.orgId,
              err: err instanceof Error ? err.message : String(err),
            },
            'weekly-digest: ошибка по member — пропускаю',
          );
        }
      }
      this.logger.debug(
        `weekly-digest: members=${memberships.length} weeklyEnqueued=${weeklyEnqueued} unrecognized=${unrecognizedFlagged} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'weekly-digest: глобальная ошибка прохода',
      );
    }
  }

  private isoWeek(d: Date): string {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
}
