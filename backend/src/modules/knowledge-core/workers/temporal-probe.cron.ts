import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TemporalProbeService } from '../services/temporal-probe.service';

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
