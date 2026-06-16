import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecognitionService } from '../services/recognition.service';

/**
 * Wave 2 — StreakDetectorCron.
 *
 * `@Cron('0 23 * * *')` — каждый день в 23:00 UTC. Идёт по всем активным
 * user'ам и обновляет currentCheckinStreak / longestCheckinStreak в
 * ContributionSnapshot на основе `DailyCheckIn` за сегодня.
 *
 * Логика:
 *   - Сегодня (по локальной дате person'а — TODO: использовать `Person.timezone`,
 *     пока используем UTC YYYY-MM-DD) есть запись DailyCheckIn с completedAt != null?
 *     → +1 к streak; longest = max(longest, current).
 *   - Если нет — reset streak в 0 (мягко, без негативных нотификаций — см. ТЗ §3).
 *
 * NB: ContributionSnapshot.userId связан с User; DailyCheckIn.personId — с Person.
 *     Связь Person.userId. Поэтому идём через Person → User.
 *
 * Доп. логика: на milestone (7 / 14 / 30 / 60 / 90 дней) — enqueue Recognition
 * type='streak_milestone'. Никаких звуков, только запись в Recognition.
 */
@Injectable()
export class StreakDetectorCron {
  private readonly logger = new Logger(StreakDetectorCron.name);

  /** Пороги (в днях), при достижении которых эмитим streak_milestone. */
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
      // 1. Берём всех Person'ов с linked User.id (только сотрудники с аккаунтом).
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
          // 2. Milestone? Эмитим только если ровно попали на пороговое число.
          if (
            checkedInToday &&
            StreakDetectorCron.MILESTONES.includes(newCurrent)
          ) {
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

  /** Был ли completedAt чек-ин у person'а на конкретную UTC-дату. */
  private async hadCheckinOn(
    personId: string,
    ymdLocal: string,
  ): Promise<boolean> {
    // DailyCheckIn.dateLocal — это уже YYYY-MM-DD в локальной TZ person'а
    // (см. schema.prisma:5257). Для MVP считаем что cron работает по UTC и
    // совпадает с локальной (TODO: использовать Person.timezone и реальную
    // локальную дату через luxon/Temporal, когда подключим библиотеку).
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
