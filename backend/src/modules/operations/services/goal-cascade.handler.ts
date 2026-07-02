import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { GoalCascadeService } from './goal-cascade.service';

interface GoalStatusChangedEvent {
  tenantId: string;
  goalId: string;
  oldStatus: string;
  newStatus: string;
}

@Injectable()
export class GoalCascadeHandler {
  private readonly logger = new Logger(GoalCascadeHandler.name);

  constructor(
    @Inject(GoalCascadeService) private readonly cascade: GoalCascadeService,
  ) {}

  @OnEvent('goal.status_changed')
  async handle(event: GoalStatusChangedEvent): Promise<void> {
    try {
      if (event.newStatus === 'achieved') {
        await this.cascade.onChildCompleted({
          tenantId: event.tenantId,
          goalId: event.goalId,
        });
      } else if (event.newStatus === 'abandoned') {
        await this.cascade.onParentMissed({
          tenantId: event.tenantId,
          parentGoalId: event.goalId,
        });
      }
    } catch (err) {
      this.logger.warn(
        {
          goalId: event.goalId,
          err: err instanceof Error ? err.message : String(err),
        },
        'goal-cascade-handler: ошибка — пропускаю',
      );
    }
  }
}
