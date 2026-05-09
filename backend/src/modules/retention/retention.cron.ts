import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RetentionService } from './retention.service';

/**
 * Retention cron — периодически прогоняет `RetentionService.processExpired`.
 *
 * NB: Cron-выражение задаётся декоратором в момент class-decoration и не
 * читается из ENV динамически. По умолчанию — каждый час, что согласовано
 * с `cfg.retention.cron` (`'0 * * * *'`). Если потребуется иной интервал,
 * регистрируем job в `SchedulerRegistry` вручную.
 */
@Injectable()
export class RetentionCron {
  private readonly logger = new Logger(RetentionCron.name);

  constructor(@Inject(RetentionService) private readonly svc: RetentionService) {}

  @Cron('0 * * * *')
  async sweep(): Promise<void> {
    try {
      const result = await this.svc.processExpired();
      if (result.processed > 0 || result.failed > 0) {
        this.logger.log(result, 'Retention cron: проход завершён');
      }
    } catch (err) {
      // Не валим NestJS — cron должен переживать сбой и попробовать ещё раз.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Retention cron: непойманная ошибка',
      );
    }
  }
}
