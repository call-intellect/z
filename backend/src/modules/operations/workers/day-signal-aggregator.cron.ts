import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { DaySignalAggregatorService } from '../services/day-signal-aggregator.service';

@Injectable()
export class DaySignalAggregatorCron {
  private readonly logger = new Logger(DaySignalAggregatorCron.name);

  constructor(
    @Inject(DaySignalAggregatorService) private readonly svc: DaySignalAggregatorService,
  ) {}

  @Cron('0 * * * *')
  async tick(): Promise<void> {
    try {
      await this.svc.runOnce(new Date());
    } catch (err) {
      this.logger.warn(`day-signal-aggregator tick упал: ${(err as Error).message}`);
    }
  }
}
