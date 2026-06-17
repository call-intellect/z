import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';

import { ProjectInboxService } from './project-inbox.service';

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
