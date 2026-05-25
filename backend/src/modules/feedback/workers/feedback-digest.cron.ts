/**
 * FeedbackDigestCron — producer ночного прогона канала «Ваши предложения».
 *
 * Расписание: `0 1 * * *` (timeZone UTC) — каждый день в 01:00 UTC. Кладёт
 * один job в очередь `core.feedback-digest`, который потребляет
 * `FeedbackDigestWorker`. jobId формируется по дате (UTC), чтобы случайный
 * двойной запуск cron'а на двух репликах не привёл к двойному прогону.
 *
 * Логика прогона — в `FeedbackDigestService.runDigest()`. Cron — тонкая
 * прослойка, чтобы её можно было независимо отключить (например, отдельный
 * ENV-флаг), не меняя сервис.
 *
 * NB: cron работает только если в процессе включён `ScheduleModule.forRoot()`.
 * В Z это уже сделано — см. `app.module.ts`.
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md §«BullMQ-воркер».
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { FeedbackDigestQueue } from './feedback-digest.queue';

@Injectable()
export class FeedbackDigestCron {
  private readonly logger = new Logger(FeedbackDigestCron.name);

  constructor(
    @Inject(FeedbackDigestQueue) private readonly queue: FeedbackDigestQueue,
  ) {}

  /**
   * Ежедневный enqueue ночного прогона. timeZone: 'UTC' — соответствует
   * UTC-окну rate-limit'а пользовательских сообщений.
   */
  @Cron('0 1 * * *', { timeZone: 'UTC' })
  async scheduleDigest(): Promise<void> {
    try {
      const { jobId } = await this.queue.enqueueCronRun();
      this.logger.log({ jobId }, 'feedback-digest.cron: enqueued');
    } catch (err) {
      // Cron не должен ронять процесс — следующий запуск через сутки.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'feedback-digest.cron: enqueue failed — повтор по расписанию',
      );
    }
  }
}
