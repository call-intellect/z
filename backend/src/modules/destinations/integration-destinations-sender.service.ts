import { Inject, Injectable, Logger } from '@nestjs/common';

import { DestinationsService } from './destinations.service';
import { SenderFactory } from './senders/sender.factory';

interface SendableTask {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeRaw: string | null;
  dueDate: Date | null;
  meetingId: string | null;
}

@Injectable()
export class IntegrationDestinationsSenderService {
  private readonly logger = new Logger(IntegrationDestinationsSenderService.name);

  constructor(
    @Inject(DestinationsService) private readonly destinations: DestinationsService,
    @Inject(SenderFactory) private readonly factory: SenderFactory,
  ) {}

  async sendTask(task: SendableTask, destinationId: string): Promise<void> {
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
