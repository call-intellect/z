import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Task } from '@prisma/client';

/**
 * Заглушка-диспетчер отправки задач во внешние интеграции (Slack/Telegram/email).
 * Реальная реализация — в M3c (`modules/destinations/`).
 *
 * При вызове бросает `NotImplementedException` с кодом `destination_module_not_ready`,
 * `AllExceptionsFilter` маппит в 501.
 */
@Injectable()
export class TasksDispatcherService {
  // eslint-disable-next-line @typescript-eslint/require-await
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
