import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Wave 2 — ContributionSnapshotCron.
 *
 * `@Cron('0 4 * * *')` — каждый день в 04:00 UTC.
 *
 * Для каждого активного User'а (имеющего хотя бы одно `Membership`) пересчитывает
 * `ContributionSnapshot`:
 *   - ideasInDevelopment / ideasShipped — из `Idea` (createdByUserId = user, status).
 *   - thanksReceived / thanksReceivedWeek — из `Recognition` (toUserId = user,
 *     type='thanks_*' за всё время / за последние 7 дней).
 *   - helpfulComments — sum количества thanks под комментариями user'а
 *     (IssueComment.authorId = user, length(thanksUserIds) > 0 → sum по длине).
 *   - probeQuestionsAnswered — из `Notification` (eventType='probe.question',
 *     recipientUserId=user, responseStatus='answered'). Pattern из probe-priority.cron.ts.
 *   - currentCheckinStreak / longestCheckinStreak — TODO: если есть данные
 *     `DailyCheckIn` (есть!) — считаем; иначе 0. На 2026-05-24 модель есть,
 *     но streak-detector cron делает основной расчёт; здесь читаем что есть.
 *
 * Идемпотентно (upsert по userId).
 *
 * NB: для bootstrap'а компании может быть >1000 user'ов. Используем
 * простую итерацию с `take: 500` chunk'ами — для MVP-нагрузки достаточно.
 * Production: оптимизация — index-only сканы / parallel batches (γ-фаза).
 */
@Injectable()
export class ContributionSnapshotCron {
  private readonly logger = new Logger(ContributionSnapshotCron.name);

  private static readonly CHUNK_SIZE = 500;
  private static readonly WEEK_MS = 7 * 24 * 3600 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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

  /** Активные user'ы — те, у кого есть хотя бы один Membership. */
  private async collectActiveUserIds(): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      select: { userId: true },
      distinct: ['userId'],
      orderBy: { userId: 'asc' },
    });
    return rows.map((r) => r.userId);
  }

  /**
   * Recompute одного user'а. Все aggregates через point-queries — для MVP
   * нагрузки приемлемо. Оптимизация — на γ-фазе через materialized view.
   */
  async recomputeOne(userId: string): Promise<void> {
    const now = new Date();
    const weekAgo = new Date(
      now.getTime() - ContributionSnapshotCron.WEEK_MS,
    );

    // 1. Ideas: createdByUserId — поле на Idea (см. schema.prisma:4717).
    const [ideasInDevelopment, ideasShipped] = await Promise.all([
      this.prisma.idea.count({
        where: { createdByUserId: userId, status: 'in_progress' },
      }),
      this.prisma.idea.count({
        where: { createdByUserId: userId, status: 'shipped' },
      }),
    ]);

    // 2. Recognition: thanks_* за всё время и за неделю.
    const thanksTypes = [
      'thanks_comment',
      'thanks_helpfulness',
      'mention_helped',
    ];
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

    // 3. helpfulComments: сумма thanksUserIds.length по комментариям user'а.
    //    Prisma не умеет sum по длине массива — берём подмножество и считаем.
    //    Для MVP: take 1000 последних комментариев user'а; если у user'а
    //    >1000 комментариев — TODO γ-фаза оптимизировать через SQL `cardinality`.
    const recentComments = await this.prisma.issueComment.findMany({
      where: { authorId: userId, deletedAt: null },
      select: { thanksUserIds: true },
      take: 1000,
    });
    const helpfulComments = recentComments.reduce(
      (acc, c) => acc + (c.thanksUserIds?.length ?? 0),
      0,
    );

    // 4. probeQuestionsAnswered: те Notification, на которые user ответил.
    const probeQuestionsAnswered = await this.prisma.notification.count({
      where: {
        recipientUserId: userId,
        eventType: 'probe.question',
        responseStatus: 'answered',
      },
    });

    // 5. currentCheckinStreak / longestCheckinStreak — читаем что было,
    //    основной расчёт делает StreakDetectorCron (23:00).
    const existing = await this.prisma.contributionSnapshot.findUnique({
      where: { userId },
      select: {
        currentCheckinStreak: true,
        longestCheckinStreak: true,
      },
    });
    const currentCheckinStreak = existing?.currentCheckinStreak ?? 0;
    const longestCheckinStreak = existing?.longestCheckinStreak ?? 0;

    // 6. Upsert.
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
        // currentCheckinStreak / longestCheckinStreak не трогаем — их пишет StreakDetectorCron.
      },
    });
  }
}
