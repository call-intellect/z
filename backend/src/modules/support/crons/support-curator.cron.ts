import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { SupportCuratorService } from '../services/support-curator.service';

/**
 * SupportCuratorCron — ночной (03:00) прогон куратора закрытого контура памяти
 * поддержки (TZ 2026-06-09 support-desk Ф4, R22).
 *
 * Куратор смотрит дневные сигналы + блоки базы и наводит порядок:
 * keep|promote|fix|merge|archive. Destructive — только за дебат-гейтом и только
 * мягко (см. SupportCuratorService).
 *
 * Kill-switch: при `cfg.supportDesk.curatorEnabled === false` — no-op (cron
 * остаётся зарегистрированным). Cron auto-discovered как провайдер модуля.
 */
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
        this.logger.log(
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
