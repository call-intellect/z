import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { ProactiveWatcherService } from '../services/proactive-watcher.service';

/**
 * SBA δ-2 — ProactiveWatcherCron.
 *
 * Каждые 6 часов (`@Cron('0 *‎/6 * * *')`) запускает полный проход
 * `ProactiveWatcherService.runOnce` — 8 правил × все Org.
 *
 * Мастер-флаг `PROACTIVE_WATCHER_ENABLED` (default true). При false cron
 * срабатывает, но сразу выходит (no-op) — позволяет включать/отключать без
 * рестарта (запуск каждые 6 часов).
 */
@Injectable()
export class ProactiveWatcherCron {
  private readonly logger = new Logger(ProactiveWatcherCron.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ProactiveWatcherService)
    private readonly svc: ProactiveWatcherService,
  ) {}

  @Cron('0 */6 * * *')
  async sweep(): Promise<void> {
    if (!this.cfg.proactive.enabled) {
      this.logger.debug(
        'proactive-watcher.cron: PROACTIVE_WATCHER_ENABLED=false, skip',
      );
      return;
    }
    const startedAt = Date.now();
    try {
      const summary = await this.svc.runOnce(new Date());
      this.logger.debug(
        { ...summary, durationMs: Date.now() - startedAt },
        'proactive-watcher.cron: проход завершён',
      );
    } catch (err) {
      this.logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startedAt,
        },
        'proactive-watcher.cron: непойманная ошибка',
      );
    }
  }
}
