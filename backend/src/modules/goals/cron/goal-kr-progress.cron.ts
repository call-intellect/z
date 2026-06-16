import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { GoalKrProgressService } from '../services/goal-kr-progress.service';

/**
 * Goals OKR v2 (Фаза 3) — cron авто-прогресса Key Results.
 *
 * @Cron('0 5 * * *') — ежедневно в 05:00 серверного времени. KR-метрики
 * (счётчик встреч / completed-задачи / mentionsCount) не меняются чаще, чем
 * раз в сутки имеет смысл пересчитывать, поэтому одного прохода достаточно.
 *
 * Что делает: для каждой Org с активными целями (`promotionState='active'`,
 * `validUntil=null`) пересчитывает `currentValue` каждого KR по `sourceKind`,
 * пишет checkpoint(recordedBy='auto') при изменении и пересчитывает
 * `Goal.progressStatus` из тренда — не перетирая ручные правки (M0).
 *
 * Cron крутится в HTTP-приложении (ScheduleModule.forRoot() в AppModule),
 * как и `StrategicAlignmentCron`.
 */
@Injectable()
export class GoalKrProgressCron {
  private readonly logger = new Logger(GoalKrProgressCron.name);

  constructor(
    @Inject(GoalKrProgressService)
    private readonly svc: GoalKrProgressService,
  ) {}

  @Cron('0 5 * * *')
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
