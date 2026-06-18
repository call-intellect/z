import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { SupportSlaService } from '../services/support-sla.service';

@Injectable()
export class SupportSlaCron {
  private readonly logger = new Logger(SupportSlaCron.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(SupportSlaService) private readonly sla: SupportSlaService,
  ) {}

  @Cron('*/5 * * * *')
  async run(): Promise<void> {
    try {
      if (!this.cfg.supportDesk.enabled) {
        return;
      }
      const breached = await this.sla.markBreaches(new Date());
      if (breached > 0) {
        this.logger.debug({ breached }, 'support-sla.cron: помечены нарушения SLA первого ответа');
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'support-sla.cron: непойманная ошибка',
      );
    }
  }
}
