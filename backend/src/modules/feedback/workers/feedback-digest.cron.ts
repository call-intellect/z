import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { FeedbackDigestQueue } from './feedback-digest.queue';

@Injectable()
export class FeedbackDigestCron {
  private readonly logger = new Logger(FeedbackDigestCron.name);

  constructor(@Inject(FeedbackDigestQueue) private readonly queue: FeedbackDigestQueue) {}

  @Cron('0 1 * * *', { timeZone: 'UTC' })
  async scheduleDigest(): Promise<void> {
    try {
      const { jobId } = await this.queue.enqueueCronRun();
      this.logger.debug({ jobId }, 'feedback-digest.cron: enqueued');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'feedback-digest.cron: enqueue failed — повтор по расписанию',
      );
    }
  }
}
