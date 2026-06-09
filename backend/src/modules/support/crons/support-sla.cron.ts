import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { SupportSlaService } from '../services/support-sla.service';

/**
 * SupportSlaCron — каждые 5 минут помечает нарушения SLA первого ответа в
 * вендор-деске (`Issue.slaBreachedAt`). ТЗ 2026-06-09 support-desk Ф1 (R12).
 *
 * Kill-switch: при `cfg.supportDesk.enabled === false` — no-op (cron остаётся
 * зарегистрированным). Cron auto-discovered как провайдер модуля.
 */
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
        this.logger.log(
          { breached },
          'support-sla.cron: помечены нарушения SLA первого ответа',
        );
      }
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'support-sla.cron: непойманная ошибка',
      );
    }
  }
}
