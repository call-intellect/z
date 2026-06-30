import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../common/config/index';

import { MessageRetentionService } from './services/message-retention.service';

@Injectable()
export class MessageRetentionCron {
  private readonly logger = new Logger(MessageRetentionCron.name);

  constructor(
    @Inject(MessageRetentionService)
    private readonly svc: MessageRetentionService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 * * * *', { name: 'message-retention-sweep' })
  async sweep(): Promise<void> {
    const days = await this.cfg.getDynamic<number>('message_retention_days', undefined, 0);
    if (days <= 0) return;

    try {
      const result = await this.svc.sweepExpired();
      if (result.deleted > 0) {
        this.logger.debug(result, 'MessageRetentionCron: проход завершён');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'MessageRetentionCron: непойманная ошибка',
      );
    }
  }
}
