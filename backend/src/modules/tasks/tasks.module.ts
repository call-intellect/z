import { Module } from '@nestjs/common';

import { TasksController } from './tasks.controller';
import { TasksDispatcherService } from './tasks-dispatcher.service';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

/**
 * Модуль задач (action items). Зависит от глобальных:
 *   - `PrismaModule`, `AuthModule`, `ConfigModule`, `AuditModule` (M3c).
 *
 * Экспортирует `TasksService` — для возможного переиспользования
 * (например, при импорте задач из webhook'а).
 */
@Module({
  controllers: [TasksController],
  providers: [TasksService, TasksRepository, TasksDispatcherService],
  exports: [TasksService],
})
export class TasksModule {}
