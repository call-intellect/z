import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';

/**
 * Calendar MVP (2026-05-25) — sweeper для отправки напоминаний.
 *
 * Каждую минуту выбирает EventReminder'ы, у которых:
 *   - sentAt IS NULL,
 *   - event.deletedAt IS NULL,
 *   - event.startAt - offsetMin*60s <= now,
 *   - event.startAt > now (не отправляем ретроспективно).
 *
 * Для каждого — enqueue в очередь `core.event-reminders` с jobId = reminderId
 * (BullMQ дедуп предотвращает двойную отправку, если cron сработает дважды).
 *
 * LIMIT 200 за тик — защита от deadlock при больших нагрузках; следующий
 * тик подхватит остаток.
 */
@Injectable()
export class EventReminderSchedulerCron {
  private readonly logger = new Logger(EventReminderSchedulerCron.name);
  private static readonly BATCH = 200;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly queue: CoreQueueService,
  ) {}

  @Cron('* * * * *')
  async sweep(): Promise<void> {
    const now = new Date();
    try {
      // Не можем сделать subquery startAt - offsetMin*60 <= now через Prisma
      // builder напрямую — берём активные reminders ближайших 7 дней и
      // фильтруем в TS. Окно 7 дней покрывает дефолтный "за 1 день" reminder
      // с большим запасом.
      const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60_000);
      const candidates = await this.prisma.eventReminder.findMany({
        where: {
          sentAt: null,
          event: { deletedAt: null, startAt: { gt: now, lte: horizon } },
        },
        include: {
          event: { select: { startAt: true, deletedAt: true } },
        },
        take: EventReminderSchedulerCron.BATCH,
        orderBy: { id: 'asc' },
      });

      let enqueued = 0;
      for (const r of candidates) {
        const dueAt = new Date(
          r.event.startAt.getTime() - r.offsetMin * 60_000,
        );
        if (dueAt > now) continue;
        await this.queue.enqueueEventReminder({ reminderId: r.id });
        enqueued++;
      }

      if (enqueued > 0) {
        this.logger.log(
          { candidates: candidates.length, enqueued },
          'EventReminderSchedulerCron — напоминания поставлены в очередь',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'EventReminderSchedulerCron — sweep упал',
      );
    }
  }
}
