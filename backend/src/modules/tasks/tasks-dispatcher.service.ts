import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Task } from '@prisma/client';

@Injectable()
export class TasksDispatcherService {
  async sendTask(_task: Task, _destinationId: string): Promise<void> {
    throw new NotImplementedException({
      ok: false,
      error: {
        code: 'destination_module_not_ready',
        message: 'Модуль интеграций ещё не подключён',
      },
    });
  }
}
