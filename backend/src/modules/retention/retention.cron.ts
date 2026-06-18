import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RetentionService } from './retention.service';

@Injectable()
export class RetentionCron {
  private readonly logger = new Logger(RetentionCron.name);

  constructor(@Inject(RetentionService) private readonly svc: RetentionService) {}

  @Cron('0 * * * *')
  async sweep(): Promise<void> {
    try {
      const result = await this.svc.processAll();
      const totals = {
        recordings: result.recordings.processed,
        rawEvents: result.rawEvents.processed,
        blocks: result.blocks.processed,
        chat: result.chat.processed,
        audit: result.audit.processed,
        failed:
          result.recordings.failed +
          result.rawEvents.failed +
          result.blocks.failed +
          result.chat.failed +
          result.audit.failed,
      };
      if (
        totals.recordings +
          totals.rawEvents +
          totals.blocks +
          totals.chat +
          totals.audit +
          totals.failed >
        0
      ) {
        this.logger.debug(totals, 'Retention cron: проход завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Retention cron: непойманная ошибка',
      );
    }
  }
}
