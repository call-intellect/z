import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TemporalProbeService } from '../services/temporal-probe.service';

/**
 * W2.4 KC-Temporal (2026-05-25) — TemporalProbeCron.
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md §W2.4.
 *
 * Раз в неделю (понедельник 07:00 UTC по умолчанию):
 *   1) `TemporalProbeService.runAllOrgs()` — поиск расхождений «древний/свежий».
 *   2) `escalateUnanswered()` — эскалация старых неотвеченных probe'ов.
 *
 * Cron-выражение в декораторе литерально — `@nestjs/schedule` парсит его при
 * DI. Hot-reload расписания живёт в CronManagerService (CronSchedule таблица).
 */
@Injectable()
export class TemporalProbeCron {
  private readonly logger = new Logger(TemporalProbeCron.name);

  constructor(
    @Inject(TemporalProbeService)
    private readonly svc: TemporalProbeService,
  ) {}

  @Cron('0 7 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.svc.runAllOrgs();
      const esc = await this.svc.escalateUnanswered();
      this.logger.debug(
        { ...stats, escalated: esc.escalated },
        'temporal-probe.cron: weekly проход завершён',
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'temporal-probe.cron: непойманная ошибка',
      );
    }
  }
}
