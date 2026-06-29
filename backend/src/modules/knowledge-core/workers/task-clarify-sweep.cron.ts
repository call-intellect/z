import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { Specialist315TasksService } from '../services/specialist-3-15-tasks.service';

@Injectable()
export class TaskClarifySweepCron {
  private readonly logger = new Logger(TaskClarifySweepCron.name);

  constructor(
    @Inject(Specialist315TasksService)
    private readonly tasks: Specialist315TasksService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 * * * *', { timeZone: 'Europe/Moscow' })
  async tick(now: Date = new Date()): Promise<void> {
    try {
      const enabled = await this.cfg.getDynamic<boolean>(
        'tracker.taskClarifySweep.enabled',
        undefined,
        true,
      );
      if (!enabled) return;
      const hourMsk = await this.cfg.getDynamic<number>(
        'tracker.taskClarifySweep.hourMsk',
        undefined,
        10,
      );
      const mskHour =
        Number(
          new Intl.DateTimeFormat('ru-RU', {
            timeZone: 'Europe/Moscow',
            hour: '2-digit',
            hour12: false,
          }).format(now),
        ) % 24;
      if (mskHour !== hourMsk) return;
      const stats = await this.tasks.runClarifySweep(now);
      this.logger.debug(stats, 'task-clarify-sweep: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'task-clarify-sweep: непойманная ошибка',
      );
    }
  }
}
