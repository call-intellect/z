import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';

import { ProjectInboxService } from './project-inbox.service';

/**
 * ImapPollCron (Tracker Phase 4, T5 — Email-to-task).
 *
 * Дёргает `ProjectInboxService.pollInbox()` по расписанию из
 * `MAIL_INBOX_POLL_CRON` (default `*\/2 * * * *` — каждые 2 минуты).
 *
 * NB: `@Cron(expr)` принимает только литеральный/константный expression,
 * но прочитать ENV до того, как Nest проинициализирует ConfigModule, не
 * получится. Используем `process.env.MAIL_INBOX_POLL_CRON ?? default` —
 * декоратор парсится при первом импорте модуля, ENV к этому моменту
 * уже доступен (Nest читает .env перед DI-загрузкой через
 * `@nestjs/config`).
 *
 * Guard `cfg.mailInbox.enabled` дополнительно проверяется в
 * `ProjectInboxService.pollInbox()` — на dev'е cron всё равно тикает, но
 * сразу выходит. Это лучше, чем регистрировать cron условно: при
 * включении флага на проде через `.env` reload не требуется.
 */
@Injectable()
export class ImapPollCron {
  private readonly logger = new Logger(ImapPollCron.name);

  constructor(
    @Inject(ProjectInboxService)
    private readonly projectInbox: ProjectInboxService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron(process.env.MAIL_INBOX_POLL_CRON ?? '*/2 * * * *')
  async handle(): Promise<void> {
    if (!this.cfg.mailInbox.enabled) return;
    try {
      await this.projectInbox.pollInbox();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'mail-inbox: pollInbox упал — следующий тик повторит',
      );
    }
  }
}
