import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Task } from '@prisma/client';

import { DestinationsService } from './destinations.service';
import { SenderFactory } from './senders/sender.factory';

/**
 * Real-implementation отправки сущностей через destinations.
 *
 * M3b (`TasksDispatcherService`) — заглушка, бросающая 501. Когда подключают
 * этот модуль, M3b может либо:
 *   а) оставить свою заглушку и инжектить этот сервис как реальный backend
 *      (через token override),
 *   б) импортировать `IntegrationDestinationsSenderService` напрямую.
 *
 * Мы НЕ перезаписываем `tasks-dispatcher.service.ts` (M3b территория).
 */
@Injectable()
export class IntegrationDestinationsSenderService {
  private readonly logger = new Logger(IntegrationDestinationsSenderService.name);

  constructor(
    @Inject(DestinationsService) private readonly destinations: DestinationsService,
    @Inject(SenderFactory) private readonly factory: SenderFactory,
  ) {}

  async sendTask(task: Task, destinationId: string): Promise<void> {
    const dest = await this.destinations.findOwned(destinationId, task.userId);
    const dueLabel = task.dueDate ? ` (до ${task.dueDate.toISOString().slice(0, 10)})` : '';
    const assigneeLabel = task.assigneeRaw ? ` — ${task.assigneeRaw}` : '';
    await this.factory.send(dest, {
      title: `Задача: ${task.title}${dueLabel}`,
      body: `${task.description ?? ''}${assigneeLabel}`,
      data: {
        taskId: task.id,
        meetingId: task.meetingId,
        status: task.status,
      },
    });
    this.logger.log(`task=${task.id} отправлен в destination=${destinationId}`);
  }
}
