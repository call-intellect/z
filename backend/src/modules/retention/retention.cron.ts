import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RetentionService } from './retention.service';

/**
 * Retention cron — периодически прогоняет `RetentionService.processAll`.
 *
 * Расписание: каждый час (`'0 * * * *'`), согласовано с `cfg.retention.cron`.
 * Cron-выражение задаётся декоратором в момент class-decoration и не
 * читается из ENV динамически.
 *
 * До Фазы 11 cron вызывал `processExpired` — только Recording. С Фазы 11
 * расширен на `processAll`, который дополнительно прогоняет per-Org sweep'ы:
 * RawEvent, IdeaBlock(archived), MeetingChatMessage, AuditLog. Каждый
 * управляется ENV-флагом `cfg.retention.*Enabled`.
 *
 * Логи структурированные: один объект со счётчиками по kind. При
 * непойманной ошибке — пишем `error`, но не валим cron'ы (следующий
 * проход попытается ещё раз).
 */
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
      // Не валим NestJS — cron должен переживать сбой и попробовать ещё раз.
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Retention cron: непойманная ошибка',
      );
    }
  }
}
