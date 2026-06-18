import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecognitionService } from '../services/recognition.service';

@Injectable()
export class StreakDetectorCron {
  private readonly logger = new Logger(StreakDetectorCron.name);

  private static readonly MILESTONES = [7, 14, 30, 60, 90, 180, 365];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecognitionService)
    private readonly recognition: RecognitionService,
  ) {}

  @Cron('0 23 * * *')
  async run(): Promise<void> {
    try {
      const startedAt = Date.now();
      const today = this.utcYmd(new Date());
      const persons = await this.prisma.person.findMany({
        where: { userId: { not: null } },
        select: {
          id: true,
          userId: true,
          tenantId: true,
          timezone: true,
        },
      });
      let updated = 0;
      let milestones = 0;
      for (const p of persons) {
        if (!p.userId) continue;
        try {
          const checkedInToday = await this.hadCheckinOn(p.id, today);
          const prev = await this.prisma.contributionSnapshot.findUnique({
            where: { userId: p.userId },
            select: {
              currentCheckinStreak: true,
              longestCheckinStreak: true,
            },
          });
          const prevCurrent = prev?.currentCheckinStreak ?? 0;
          const prevLongest = prev?.longestCheckinStreak ?? 0;
          const newCurrent = checkedInToday ? prevCurrent + 1 : 0;
          const newLongest = Math.max(prevLongest, newCurrent);
          await this.prisma.contributionSnapshot.upsert({
            where: { userId: p.userId },
            create: {
              userId: p.userId,
              currentCheckinStreak: newCurrent,
              longestCheckinStreak: newLongest,
            },
            update: {
              currentCheckinStreak: newCurrent,
              longestCheckinStreak: newLongest,
            },
          });
          updated += 1;
          if (checkedInToday && StreakDetectorCron.MILESTONES.includes(newCurrent)) {
            await this.recognition.enqueueFormulate({
              tenantId: p.tenantId,
              type: 'streak_milestone',
              toUserId: p.userId,
              fromUserId: null,
              contextEntityType: 'checkin',
              contextEntityId: String(newCurrent),
              visibility: 'private',
              contextPayload: { days: newCurrent },
            });
            milestones += 1;
          }
        } catch (err) {
          this.logger.warn(
            {
              personId: p.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'streak-detector: ошибка по person — пропускаю',
          );
        }
      }
      this.logger.debug(
        `streak-detector: persons=${persons.length} updated=${updated} milestones=${milestones} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'streak-detector: глобальная ошибка прохода',
      );
    }
  }

  private async hadCheckinOn(personId: string, ymdLocal: string): Promise<boolean> {
    const count = await this.prisma.dailyCheckIn.count({
      where: {
        personId,
        dateLocal: ymdLocal,
        completedAt: { not: null },
      },
    });
    return count > 0;
  }

  private utcYmd(d: Date): string {
    const y = d.getUTCFullYear().toString().padStart(4, '0');
    const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = d.getUTCDate().toString().padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
