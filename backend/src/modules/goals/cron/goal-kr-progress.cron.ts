import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { GoalKrProgressService } from '../services/goal-kr-progress.service';

@Injectable()
export class GoalKrProgressCron {
  private readonly logger = new Logger(GoalKrProgressCron.name);

  constructor(
    @Inject(GoalKrProgressService)
    private readonly svc: GoalKrProgressService,
  ) {}

  @Cron('0 5 * * *', { timeZone: 'Europe/Moscow' })
  async runForAllOrgs(): Promise<void> {
    try {
      const summary = await this.svc.runForAllOrgs();
      this.logger.debug(summary, 'goal-kr-progress.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'goal-kr-progress.cron: непойманная ошибка — повтор завтра',
      );
    }
  }
}
