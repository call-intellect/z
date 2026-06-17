import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { SupportCuratorService } from '../services/support-curator.service';

@Injectable()
export class SupportCuratorCron {
  private readonly logger = new Logger(SupportCuratorCron.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(SupportCuratorService)
    private readonly curator: SupportCuratorService,
  ) {}

  @Cron('0 3 * * *')
  async run(): Promise<void> {
    try {
      if (!this.cfg.supportDesk.curatorEnabled) {
        return;
      }
      const result = await this.curator.runOnce(new Date());
      if (!result.skipped) {
        this.logger.debug(
          { proposed: result.proposed, applied: result.applied },
          'support-curator.cron: ночной прогон контура завершён',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'support-curator.cron: непойманная ошибка',
      );
    }
  }
}
